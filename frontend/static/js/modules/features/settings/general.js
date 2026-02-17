(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateGeneralForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "general");

        // Build timezone options
        const timezoneOptions = (() => {
            const predefinedTimezones = [
                "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu",
                "America/Toronto", "America/Vancouver", "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "America/Mexico_City",
                "America/Phoenix", "America/Anchorage", "America/Halifax", "America/St_Johns", "America/Lima", "America/Bogota",
                "America/Caracas", "America/Santiago", "America/La_Paz",
                "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "Europe/Rome", "Europe/Madrid",
                "Europe/Stockholm", "Europe/Zurich", "Europe/Vienna", "Europe/Prague", "Europe/Warsaw", "Europe/Budapest",
                "Europe/Bucharest", "Europe/Sofia", "Europe/Athens", "Europe/Helsinki", "Europe/Oslo", "Europe/Copenhagen",
                "Europe/Brussels", "Europe/Lisbon", "Europe/Dublin", "Europe/Moscow", "Europe/Kiev", "Europe/Minsk",
                "Europe/Riga", "Europe/Tallinn", "Europe/Vilnius",
                "Africa/Cairo", "Africa/Lagos", "Africa/Nairobi", "Africa/Casablanca", "Africa/Johannesburg",
                "Asia/Dubai", "Asia/Qatar", "Asia/Kuwait", "Asia/Riyadh", "Asia/Tehran", "Asia/Tashkent", "Asia/Almaty",
                "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore", "Asia/Bangkok", "Asia/Kolkata",
                "Asia/Karachi", "Asia/Jakarta", "Asia/Manila", "Asia/Kuala_Lumpur", "Asia/Taipei", "Asia/Yekaterinburg",
                "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Adelaide", "Australia/Perth",
                "Pacific/Auckland", "Pacific/Fiji", "Pacific/Guam"
            ];
            let custom = "";
            const ct = settings.timezone;
            if (ct && !predefinedTimezones.includes(ct)) {
                custom = `<option value="${ct}" selected>${ct} (Custom from Environment)</option>`;
            }
            const labels = {
                "UTC": "UTC (Coordinated Universal Time)",
                "America/New_York": "Eastern Time (America/New_York)", "America/Chicago": "Central Time (America/Chicago)",
                "America/Denver": "Mountain Time (America/Denver)", "America/Los_Angeles": "Pacific Time (America/Los_Angeles)",
                "Pacific/Honolulu": "Hawaii Time (Pacific/Honolulu)", "America/Toronto": "Eastern Canada (America/Toronto)",
                "America/Vancouver": "Pacific Canada (America/Vancouver)", "America/Sao_Paulo": "Brazil (America/Sao_Paulo)",
                "America/Argentina/Buenos_Aires": "Argentina (America/Argentina/Buenos_Aires)", "America/Mexico_City": "Mexico (America/Mexico_City)",
                "America/Phoenix": "Arizona (America/Phoenix)", "America/Anchorage": "Alaska (America/Anchorage)",
                "America/Halifax": "Atlantic Canada (America/Halifax)", "America/St_Johns": "Newfoundland (America/St_Johns)",
                "America/Lima": "Peru (America/Lima)", "America/Bogota": "Colombia (America/Bogota)",
                "America/Caracas": "Venezuela (America/Caracas)", "America/Santiago": "Chile (America/Santiago)",
                "America/La_Paz": "Bolivia (America/La_Paz)", "Europe/London": "UK Time (Europe/London)",
                "Europe/Paris": "Central Europe (Europe/Paris)", "Europe/Berlin": "Germany (Europe/Berlin)",
                "Europe/Amsterdam": "Netherlands (Europe/Amsterdam)", "Europe/Rome": "Italy (Europe/Rome)",
                "Europe/Madrid": "Spain (Europe/Madrid)", "Europe/Stockholm": "Sweden (Europe/Stockholm)",
                "Europe/Zurich": "Switzerland (Europe/Zurich)", "Europe/Vienna": "Austria (Europe/Vienna)",
                "Europe/Prague": "Czech Republic (Europe/Prague)", "Europe/Warsaw": "Poland (Europe/Warsaw)",
                "Europe/Budapest": "Hungary (Europe/Budapest)", "Europe/Bucharest": "Romania (Europe/Bucharest)",
                "Europe/Sofia": "Bulgaria (Europe/Sofia)", "Europe/Athens": "Greece (Europe/Athens)",
                "Europe/Helsinki": "Finland (Europe/Helsinki)", "Europe/Oslo": "Norway (Europe/Oslo)",
                "Europe/Copenhagen": "Denmark (Europe/Copenhagen)", "Europe/Brussels": "Belgium (Europe/Brussels)",
                "Europe/Lisbon": "Portugal (Europe/Lisbon)", "Europe/Dublin": "Ireland (Europe/Dublin)",
                "Europe/Moscow": "Russia Moscow (Europe/Moscow)", "Europe/Kiev": "Ukraine (Europe/Kiev)",
                "Europe/Minsk": "Belarus (Europe/Minsk)", "Europe/Riga": "Latvia (Europe/Riga)",
                "Europe/Tallinn": "Estonia (Europe/Tallinn)", "Europe/Vilnius": "Lithuania (Europe/Vilnius)",
                "Africa/Cairo": "Egypt (Africa/Cairo)", "Africa/Lagos": "Nigeria (Africa/Lagos)",
                "Africa/Nairobi": "Kenya (Africa/Nairobi)", "Africa/Casablanca": "Morocco (Africa/Casablanca)",
                "Africa/Johannesburg": "South Africa (Africa/Johannesburg)", "Asia/Dubai": "UAE (Asia/Dubai)",
                "Asia/Qatar": "Qatar (Asia/Qatar)", "Asia/Kuwait": "Kuwait (Asia/Kuwait)",
                "Asia/Riyadh": "Saudi Arabia (Asia/Riyadh)", "Asia/Tehran": "Iran (Asia/Tehran)",
                "Asia/Tashkent": "Uzbekistan (Asia/Tashkent)", "Asia/Almaty": "Kazakhstan (Asia/Almaty)",
                "Asia/Tokyo": "Japan (Asia/Tokyo)", "Asia/Seoul": "South Korea (Asia/Seoul)",
                "Asia/Shanghai": "China (Asia/Shanghai)", "Asia/Hong_Kong": "Hong Kong (Asia/Hong_Kong)",
                "Asia/Singapore": "Singapore (Asia/Singapore)", "Asia/Bangkok": "Thailand (Asia/Bangkok)",
                "Asia/Kolkata": "India (Asia/Kolkata)", "Asia/Karachi": "Pakistan (Asia/Karachi)",
                "Asia/Jakarta": "Indonesia (Asia/Jakarta)", "Asia/Manila": "Philippines (Asia/Manila)",
                "Asia/Kuala_Lumpur": "Malaysia (Asia/Kuala_Lumpur)", "Asia/Taipei": "Taiwan (Asia/Taipei)",
                "Asia/Yekaterinburg": "Russia Yekaterinburg (Asia/Yekaterinburg)",
                "Australia/Sydney": "Australia East (Australia/Sydney)", "Australia/Melbourne": "Australia Melbourne (Australia/Melbourne)",
                "Australia/Brisbane": "Australia Brisbane (Australia/Brisbane)", "Australia/Adelaide": "Australia Adelaide (Australia/Adelaide)",
                "Australia/Perth": "Australia West (Australia/Perth)", "Pacific/Auckland": "New Zealand (Pacific/Auckland)",
                "Pacific/Fiji": "Fiji (Pacific/Fiji)", "Pacific/Guam": "Guam (Pacific/Guam)"
            };
            return custom + predefinedTimezones.map(tz =>
                `<option value="${tz}" ${settings.timezone === tz || (tz === "UTC" && !settings.timezone) ? "selected" : ""}>${labels[tz] || tz}</option>`
            ).join("\n");
        })();

        container.innerHTML = `
            <!-- Two-column grid (header is in template) -->
            <div class="mset-grid">

                <!-- System Settings card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-blue"><i class="fas fa-globe"></i></div>
                        <h3>System Settings</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="timezone">Timezone:</label>
                            <select id="timezone" name="timezone" class="mset-select">${timezoneOptions}</select>
                            <p class="setting-help">Set your timezone for accurate time display in logs and scheduling. Changes are applied immediately.</p>
                        </div>
                        <div class="setting-item" style="margin-top: 15px;">
                            <label for="tmdb_image_cache_days">TMDB Image Cache:</label>
                            <select id="tmdb_image_cache_days" class="mset-select">
                                <option value="0" ${settings.tmdb_image_cache_days === 0 ? "selected" : ""}>Disabled (Always Load)</option>
                                <option value="1" ${settings.tmdb_image_cache_days === 1 ? "selected" : ""}>1 Day</option>
                                <option value="7" ${settings.tmdb_image_cache_days === 7 ? "selected" : ""}>7 Days</option>
                                <option value="30" ${(settings.tmdb_image_cache_days === 30 || settings.tmdb_image_cache_days === undefined) ? "selected" : ""}>30 Days</option>
                            </select>
                            <p class="setting-help">Cache TMDB images to reduce load times and API usage. Missing images will still attempt to load.</p>
                        </div>
                        <div class="setting-item flex-row" style="margin-top: 15px;" id="show_trending_setting_item">
                            <label for="show_trending">Show Smart Hunt on Home:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="show_trending" ${settings.show_trending !== false ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help">Display the Smart Hunt carousel on the Home page. Configure mix settings in Requestarr &gt; Smart Hunt.</p>
                        <div class="setting-item flex-row" style="margin-top: 15px;">
                            <label for="show_nzb_hunt_on_home">Show NZB Hunt on Home:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="show_nzb_hunt_on_home" ${settings.show_nzb_hunt_on_home === true ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help">Display the NZB Hunt status bar on the Home page with live speed, connections, and ETA when servers are configured.</p>
                    </div>
                </div>

                <!-- Huntarr Operations card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-blue"><i class="fas fa-cogs"></i></div>
                        <h3>Huntarr Operations</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item flex-row">
                            <label for="disable_requests">Disable Requests:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="disable_requests" ${settings.enable_requestarr === false ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help">When enabled, the Requests section (Discover, TV Shows, Movies, etc.) is fully off—no UI, logging, or background work. Saves compute.</p>
                        <div class="setting-item flex-row" style="margin-top: 15px;">
                            <label for="disable_media_hunt">Disable Media Hunt &amp; NZB Hunt:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="disable_media_hunt" ${settings.enable_media_hunt === false ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help">When enabled, Media Hunt, NZB Hunt, and Index Master are fully off—no UI, logging, or background work. Saves compute.</p>
                        <div class="setting-item flex-row" style="margin-top: 15px;">
                            <label for="disable_third_party_apps">Disable 3rd Party Apps:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="disable_third_party_apps" ${settings.enable_third_party_apps === false ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help">When enabled, 3rd Party Apps (Sonarr, Radarr, etc.) are fully off—no UI, logging, or hunt cycles. Saves compute.</p>
                    </div>
                </div>

                <!-- Security card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-amber"><i class="fas fa-shield-alt"></i></div>
                        <h3>Security</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="auth_mode">Authentication Mode:</label>
                            <select id="auth_mode" name="auth_mode" class="mset-select">
                                <option value="login" ${settings.auth_mode === "login" || (!settings.auth_mode && !settings.local_access_bypass && !settings.proxy_auth_bypass) ? "selected" : ""}>Login Mode</option>
                                <option value="local_bypass" ${settings.auth_mode === "local_bypass" || (!settings.auth_mode && settings.local_access_bypass === true && !settings.proxy_auth_bypass) ? "selected" : ""}>Local Bypass Mode</option>
                                <option value="no_login" ${settings.auth_mode === "no_login" || (!settings.auth_mode && settings.proxy_auth_bypass === true) ? "selected" : ""}>No Login Mode</option>
                            </select>
                            <p class="setting-help">Login Mode: Standard login. Local Bypass: No login on local network. No Login: Completely open (use behind proxy).</p>
                        </div>
                        <div class="setting-item flex-row">
                            <label for="ssl_verify">Enable SSL Verify:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="ssl_verify" ${settings.ssl_verify === true ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help">Disable SSL certificate verification when using self-signed certificates.</p>
                    </div>
                </div>

                <!-- Advanced Settings card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-purple"><i class="fas fa-terminal"></i></div>
                        <h3>Advanced Settings</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item" style="margin-top: 15px; border-top: 1px solid rgba(148, 163, 184, 0.08); padding-top: 15px;">
                            <label for="base_url">Base URL:</label>
                            <input type="text" id="base_url" value="${settings.base_url || ""}" placeholder="/huntarr" class="mset-input">
                            <p class="setting-help">Base URL path for reverse proxy. Requires restart.</p>
                        </div>
                        <div class="setting-item">
                            <label for="dev_key">Huntarr Dev Key:${settings.dev_mode === true ? ' <i class="fas fa-check-circle" style="color: #22c55e; margin-left: 5px;" title="Dev Mode Active"></i>' : ''}</label>
                            <input type="password" id="dev_key" value="${settings.dev_key || ""}" placeholder="Enter dev key" class="mset-input">
                            <p class="setting-help">Enter development key to enable dev mode.</p>
                        </div>
                        <div class="setting-item" style="margin-top: 15px;">
                            <label for="web_server_threads">Web Server Threads:</label>
                            <select id="web_server_threads" class="mset-select">
                                <option value="8" ${settings.web_server_threads === 8 ? "selected" : ""}>8 (Light)</option>
                                <option value="16" ${settings.web_server_threads === 16 ? "selected" : ""}>16 (Moderate)</option>
                                <option value="32" ${(settings.web_server_threads === 32 || !settings.web_server_threads) ? "selected" : ""}>32 (Default)</option>
                                <option value="48" ${settings.web_server_threads === 48 ? "selected" : ""}>48 (Heavy)</option>
                                <option value="64" ${settings.web_server_threads === 64 ? "selected" : ""}>64 (High Load)</option>
                                <option value="96" ${settings.web_server_threads === 96 ? "selected" : ""}>96 (Maximum)</option>
                            </select>
                            <p class="setting-help">Number of web server worker threads for handling concurrent requests. Increase if using many apps/instances. Requires restart.</p>
                        </div>
                        <div class="setting-item" style="margin-top: 15px; border-top: 1px solid rgba(148, 163, 184, 0.08); padding-top: 15px;">
                            <label>Reset Media Hunt Wizard:</label>
                            <button type="button" id="reset-media-hunt-wizard-btn" class="mset-btn-secondary" style="margin-top: 6px; padding: 7px 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 6px; color: #f87171; font-size: 0.85rem; cursor: pointer; transition: all 0.15s;">
                                <i class="fas fa-redo"></i> Reset Wizard
                            </button>
                            <p class="setting-help">Re-show the Media Hunt setup wizard on next visit. Useful if you skipped the wizard and want to run it again.</p>
                        </div>
                        <div class="setting-item" style="margin-top: 15px; border-top: 1px solid rgba(148, 163, 184, 0.08); padding-top: 15px;">
                            <label>Reset Welcome Message:</label>
                            <button type="button" id="reset-welcome-message-btn" class="mset-btn-secondary" style="margin-top: 6px; padding: 7px 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 6px; color: #f87171; font-size: 0.85rem; cursor: pointer; transition: all 0.15s;">
                                <i class="fas fa-envelope-open"></i> Reset Welcome
                            </button>
                            <p class="setting-help">Re-show the welcome message on the Home page. Useful for testing or if you want to see the welcome message again.</p>
                        </div>
                    </div>
                </div>


            </div>
        `;

        // Reset Media Hunt Wizard button
        var resetWizardBtn = container.querySelector('#reset-media-hunt-wizard-btn');
        if (resetWizardBtn) {
            resetWizardBtn.addEventListener('click', function() {
                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({
                        title: 'Reset Media Hunt Wizard',
                        message: 'This will re-show the Media Hunt setup wizard on your next visit to Media Hunt. Continue?',
                        confirmLabel: 'Reset',
                        cancelLabel: 'Cancel',
                        onConfirm: function() {
                            // Update in-memory prefs
                            if (window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings.general) {
                                var prefs = window.huntarrUI.originalSettings.general.ui_preferences || {};
                                prefs['media-hunt-wizard-completed'] = false;
                                window.huntarrUI.originalSettings.general.ui_preferences = prefs;
                            }
                            // Save directly to server (don't rely on setUIPreference chaining)
                            HuntarrUtils.fetchWithTimeout('./api/settings/general', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ui_preferences: { 'media-hunt-wizard-completed': false } })
                            }).then(function() {
                                if (window.HuntarrToast) window.HuntarrToast.success('Media Hunt wizard has been reset. It will show on your next visit to Media Hunt.');
                            }).catch(function(err) {
                                console.error('[ResetWizard] Failed to save:', err);
                                if (window.HuntarrToast) window.HuntarrToast.error('Failed to save wizard reset.');
                            });
                            // Set a force-show flag so the wizard appears even if all steps are done
                            try { sessionStorage.setItem('setup-wizard-force-show', '1'); } catch (e) {}
                        }
                    });
                } else {
                    if (confirm('Reset the Media Hunt wizard? It will show again on your next visit.')) {
                        if (window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings.general) {
                            var prefs = window.huntarrUI.originalSettings.general.ui_preferences || {};
                            prefs['media-hunt-wizard-completed'] = false;
                            window.huntarrUI.originalSettings.general.ui_preferences = prefs;
                        }
                        HuntarrUtils.fetchWithTimeout('./api/settings/general', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ui_preferences: { 'media-hunt-wizard-completed': false } })
                        }).catch(function(err) { console.error('[ResetWizard] Failed to save:', err); });
                        try { sessionStorage.setItem('setup-wizard-force-show', '1'); } catch (e) {}
                    }
                }
            });
        }

        // Reset Welcome Message button
        var resetWelcomeBtn = container.querySelector('#reset-welcome-message-btn');
        if (resetWelcomeBtn) {
            resetWelcomeBtn.addEventListener('click', function() {
                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({
                        title: 'Reset Welcome Message',
                        message: 'This will re-show the welcome message the next time you visit the Home page. Continue?',
                        confirmLabel: 'Reset',
                        cancelLabel: 'Cancel',
                        onConfirm: function() {
                            HuntarrUtils.setUIPreference('welcome-dismissed', false);
                            if (window.HuntarrToast) window.HuntarrToast.success('Welcome message has been reset. It will show on your next visit to Home.');
                        }
                    });
                } else {
                    if (confirm('Reset the welcome message? It will show again on your next Home page visit.')) {
                        HuntarrUtils.setUIPreference('welcome-dismissed', false);
                    }
                }
            });
        }

        if (window.SettingsForms.setupSettingsManualSave) {
            window.SettingsForms.setupSettingsManualSave(container, settings);
        }
    };

    window.SettingsForms.setupSettingsManualSave = function(container, originalSettings = {}) {
        let saveButton = container.querySelector("#settings-save-button");
        if (!saveButton) saveButton = document.getElementById("settings-save-button");
        if (!saveButton) return;

        saveButton.disabled = true;
        saveButton.classList.remove("mset-save-active");

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
                btn.classList.add("mset-save-active");
                if (window.SettingsForms.addUnsavedChangesWarning) {
                    window.SettingsForms.addUnsavedChangesWarning();
                }
            } else {
                btn.disabled = true;
                btn.classList.remove("mset-save-active");
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

            const settings = window.SettingsForms.getFormSettings(container, "general");
            window.SettingsForms.saveAppSettings("general", settings, "Settings saved successfully", { section: "main" })
                .then(function() {
                    if (window.huntarrUI) {
                        window.huntarrUI._enableRequestarr = settings.enable_requestarr !== false;
                        window.huntarrUI._enableMediaHunt = settings.enable_media_hunt !== false;
                        window.huntarrUI._enableThirdPartyApps = settings.enable_third_party_apps !== false;
                    }
                    // Update sidebar visibility immediately from saved settings (don't rely on async fetch)
                    var requestsGroup = document.getElementById('nav-group-requests');
                    var mediaHuntGroup = document.getElementById('nav-group-media-hunt');
                    var nzbHuntGroup = document.getElementById('nzb-hunt-sidebar-group');
                    var appsGroup = document.getElementById('nav-group-apps');
                    var appsLabel = document.getElementById('nav-group-apps-label');
                    if (requestsGroup) requestsGroup.style.display = (settings.enable_requestarr === false) ? 'none' : '';
                    if (mediaHuntGroup) mediaHuntGroup.style.display = (settings.enable_media_hunt === false) ? 'none' : '';
                    if (nzbHuntGroup) nzbHuntGroup.style.display = (settings.enable_media_hunt === false) ? 'none' : '';
                    if (appsGroup) appsGroup.style.display = (settings.enable_third_party_apps === false) ? 'none' : '';
                    if (appsLabel) appsLabel.style.display = (settings.enable_media_hunt === false && settings.enable_third_party_apps === false) ? 'none' : '';
                    if (typeof window.applyFeatureFlags === 'function') window.applyFeatureFlags();
                    if (window.HomeRequestarr && typeof window.HomeRequestarr.applyTrendingVisibility === 'function') {
                        window.HomeRequestarr.applyTrendingVisibility();
                    }
                    if (window.huntarrUI && window.huntarrUI.currentSection === 'home') {
                        if (window.HuntarrStats && typeof window.HuntarrStats.loadMediaStats === 'function') {
                            window.HuntarrStats.loadMediaStats(true);
                        }
                        if (window.HuntarrIndexerHuntHome && typeof window.HuntarrIndexerHuntHome.load === 'function') {
                            window.HuntarrIndexerHuntHome.load();
                        }
                    }
                }).catch(function() {});

            if (liveBtn) liveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
            updateSaveButtonState(false);
        });
    };
})();
