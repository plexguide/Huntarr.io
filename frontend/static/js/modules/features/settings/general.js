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
            <div class="settings-group" style="
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
                border: 2px solid rgba(90, 109, 137, 0.3);
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0 25px 0;
                box-shadow: 0 4px 12px rgba(90, 109, 137, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            ">
                <h3>System Settings</h3>
                <div class="setting-item">
                    <label for="check_for_updates"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#check-for-updates" class="info-icon" title="Learn more about update checking" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Check for Updates:</label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="check_for_updates" ${
                          settings.check_for_updates !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help" style="margin-left: -3ch !important;">Automatically check for Huntarr updates</p>
                </div>

                <div class="setting-item">
                    <label for="timezone"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#timezone" class="info-icon" title="Set your timezone for accurate time display" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Timezone:</label>
                    <select id="timezone" name="timezone" style="width: 300px; padding: 8px 12px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.1); background-color: #1f2937; color: #d1d5db;">
                        ${(() => {
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
                          const currentTimezone = settings.timezone;
                          if (currentTimezone && !predefinedTimezones.includes(currentTimezone)) {
                            return `<option value="${currentTimezone}" selected>${currentTimezone} (Custom from Environment)</option>`;
                          }
                          return "";
                        })()}
                        <option value="UTC" ${settings.timezone === "UTC" || !settings.timezone ? "selected" : ""}>UTC (Coordinated Universal Time)</option>
                        <option value="America/New_York" ${settings.timezone === "America/New_York" ? "selected" : ""}>Eastern Time (America/New_York)</option>
                        <option value="America/Chicago" ${settings.timezone === "America/Chicago" ? "selected" : ""}>Central Time (America/Chicago)</option>
                        <option value="America/Denver" ${settings.timezone === "America/Denver" ? "selected" : ""}>Mountain Time (America/Denver)</option>
                        <option value="America/Los_Angeles" ${settings.timezone === "America/Los_Angeles" ? "selected" : ""}>Pacific Time (America/Los_Angeles)</option>
                        <option value="Pacific/Honolulu" ${settings.timezone === "Pacific/Honolulu" ? "selected" : ""}>Hawaii Time (Pacific/Honolulu)</option>
                        <option value="America/Toronto" ${settings.timezone === "America/Toronto" ? "selected" : ""}>Eastern Canada (America/Toronto)</option>
                        <option value="America/Vancouver" ${settings.timezone === "America/Vancouver" ? "selected" : ""}>Pacific Canada (America/Vancouver)</option>
                        <option value="America/Sao_Paulo" ${settings.timezone === "America/Sao_Paulo" ? "selected" : ""}>Brazil (America/Sao_Paulo)</option>
                        <option value="America/Argentina/Buenos_Aires" ${settings.timezone === "America/Argentina/Buenos_Aires" ? "selected" : ""}>Argentina (America/Argentina/Buenos_Aires)</option>
                        <option value="America/Mexico_City" ${settings.timezone === "America/Mexico_City" ? "selected" : ""}>Mexico (America/Mexico_City)</option>
                        <option value="America/Phoenix" ${settings.timezone === "America/Phoenix" ? "selected" : ""}>Arizona (America/Phoenix)</option>
                        <option value="America/Anchorage" ${settings.timezone === "America/Anchorage" ? "selected" : ""}>Alaska (America/Anchorage)</option>
                        <option value="America/Halifax" ${settings.timezone === "America/Halifax" ? "selected" : ""}>Atlantic Canada (America/Halifax)</option>
                        <option value="America/St_Johns" ${settings.timezone === "America/St_Johns" ? "selected" : ""}>Newfoundland (America/St_Johns)</option>
                        <option value="America/Lima" ${settings.timezone === "America/Lima" ? "selected" : ""}>Peru (America/Lima)</option>
                        <option value="America/Bogota" ${settings.timezone === "America/Bogota" ? "selected" : ""}>Colombia (America/Bogota)</option>
                        <option value="America/Caracas" ${settings.timezone === "America/Caracas" ? "selected" : ""}>Venezuela (America/Caracas)</option>
                        <option value="America/Santiago" ${settings.timezone === "America/Santiago" ? "selected" : ""}>Chile (America/Santiago)</option>
                        <option value="America/La_Paz" ${settings.timezone === "America/La_Paz" ? "selected" : ""}>Bolivia (America/La_Paz)</option>
                        <option value="Europe/London" ${settings.timezone === "Europe/London" ? "selected" : ""}>UK Time (Europe/London)</option>
                        <option value="Europe/Paris" ${settings.timezone === "Europe/Paris" ? "selected" : ""}>Central Europe (Europe/Paris)</option>
                        <option value="Europe/Berlin" ${settings.timezone === "Europe/Berlin" ? "selected" : ""}>Germany (Europe/Berlin)</option>
                        <option value="Europe/Amsterdam" ${settings.timezone === "Europe/Amsterdam" ? "selected" : ""}>Netherlands (Europe/Amsterdam)</option>
                        <option value="Europe/Rome" ${settings.timezone === "Europe/Rome" ? "selected" : ""}>Italy (Europe/Rome)</option>
                        <option value="Europe/Madrid" ${settings.timezone === "Europe/Madrid" ? "selected" : ""}>Spain (Europe/Madrid)</option>
                        <option value="Europe/Stockholm" ${settings.timezone === "Europe/Stockholm" ? "selected" : ""}>Sweden (Europe/Stockholm)</option>
                        <option value="Europe/Zurich" ${settings.timezone === "Europe/Zurich" ? "selected" : ""}>Switzerland (Europe/Zurich)</option>
                        <option value="Europe/Vienna" ${settings.timezone === "Europe/Vienna" ? "selected" : ""}>Austria (Europe/Vienna)</option>
                        <option value="Europe/Prague" ${settings.timezone === "Europe/Prague" ? "selected" : ""}>Czech Republic (Europe/Prague)</option>
                        <option value="Europe/Warsaw" ${settings.timezone === "Europe/Warsaw" ? "selected" : ""}>Poland (Europe/Warsaw)</option>
                        <option value="Europe/Budapest" ${settings.timezone === "Europe/Budapest" ? "selected" : ""}>Hungary (Europe/Budapest)</option>
                        <option value="Europe/Bucharest" ${settings.timezone === "Europe/Bucharest" ? "selected" : ""}>Romania (Europe/Bucharest)</option>
                        <option value="Europe/Sofia" ${settings.timezone === "Europe/Sofia" ? "selected" : ""}>Bulgaria (Europe/Sofia)</option>
                        <option value="Europe/Athens" ${settings.timezone === "Europe/Athens" ? "selected" : ""}>Greece (Europe/Athens)</option>
                        <option value="Europe/Helsinki" ${settings.timezone === "Europe/Helsinki" ? "selected" : ""}>Finland (Europe/Helsinki)</option>
                        <option value="Europe/Oslo" ${settings.timezone === "Europe/Oslo" ? "selected" : ""}>Norway (Europe/Oslo)</option>
                        <option value="Europe/Copenhagen" ${settings.timezone === "Europe/Copenhagen" ? "selected" : ""}>Denmark (Europe/Copenhagen)</option>
                        <option value="Europe/Brussels" ${settings.timezone === "Europe/Brussels" ? "selected" : ""}>Belgium (Europe/Brussels)</option>
                        <option value="Europe/Lisbon" ${settings.timezone === "Europe/Lisbon" ? "selected" : ""}>Portugal (Europe/Lisbon)</option>
                        <option value="Europe/Dublin" ${settings.timezone === "Europe/Dublin" ? "selected" : ""}>Ireland (Europe/Dublin)</option>
                        <option value="Europe/Moscow" ${settings.timezone === "Europe/Moscow" ? "selected" : ""}>Russia Moscow (Europe/Moscow)</option>
                        <option value="Europe/Kiev" ${settings.timezone === "Europe/Kiev" ? "selected" : ""}>Ukraine (Europe/Kiev)</option>
                        <option value="Europe/Minsk" ${settings.timezone === "Europe/Minsk" ? "selected" : ""}>Belarus (Europe/Minsk)</option>
                        <option value="Europe/Riga" ${settings.timezone === "Europe/Riga" ? "selected" : ""}>Latvia (Europe/Riga)</option>
                        <option value="Europe/Tallinn" ${settings.timezone === "Europe/Tallinn" ? "selected" : ""}>Estonia (Europe/Tallinn)</option>
                        <option value="Europe/Vilnius" ${settings.timezone === "Europe/Vilnius" ? "selected" : ""}>Lithuania (Europe/Vilnius)</option>
                        <option value="Africa/Cairo" ${settings.timezone === "Africa/Cairo" ? "selected" : ""}>Egypt (Africa/Cairo)</option>
                        <option value="Africa/Lagos" ${settings.timezone === "Africa/Lagos" ? "selected" : ""}>Nigeria (Africa/Lagos)</option>
                        <option value="Africa/Nairobi" ${settings.timezone === "Africa/Nairobi" ? "selected" : ""}>Kenya (Africa/Nairobi)</option>
                        <option value="Africa/Casablanca" ${settings.timezone === "Africa/Casablanca" ? "selected" : ""}>Morocco (Africa/Casablanca)</option>
                        <option value="Africa/Johannesburg" ${settings.timezone === "Africa/Johannesburg" ? "selected" : ""}>South Africa (Africa/Johannesburg)</option>
                        <option value="Asia/Dubai" ${settings.timezone === "Asia/Dubai" ? "selected" : ""}>UAE (Asia/Dubai)</option>
                        <option value="Asia/Qatar" ${settings.timezone === "Asia/Qatar" ? "selected" : ""}>Qatar (Asia/Qatar)</option>
                        <option value="Asia/Kuwait" ${settings.timezone === "Asia/Kuwait" ? "selected" : ""}>Kuwait (Asia/Kuwait)</option>
                        <option value="Asia/Riyadh" ${settings.timezone === "Asia/Riyadh" ? "selected" : ""}>Saudi Arabia (Asia/Riyadh)</option>
                        <option value="Asia/Tehran" ${settings.timezone === "Asia/Tehran" ? "selected" : ""}>Iran (Asia/Tehran)</option>
                        <option value="Asia/Tashkent" ${settings.timezone === "Asia/Tashkent" ? "selected" : ""}>Uzbekistan (Asia/Tashkent)</option>
                        <option value="Asia/Almaty" ${settings.timezone === "Asia/Almaty" ? "selected" : ""}>Kazakhstan (Asia/Almaty)</option>
                        <option value="Asia/Tokyo" ${settings.timezone === "Asia/Tokyo" ? "selected" : ""}>Japan (Asia/Tokyo)</option>
                        <option value="Asia/Seoul" ${settings.timezone === "Asia/Seoul" ? "selected" : ""}>South Korea (Asia/Seoul)</option>
                        <option value="Asia/Shanghai" ${settings.timezone === "Asia/Shanghai" ? "selected" : ""}>China (Asia/Shanghai)</option>
                        <option value="Asia/Hong_Kong" ${settings.timezone === "Asia/Hong_Kong" ? "selected" : ""}>Hong Kong (Asia/Hong_Kong)</option>
                        <option value="Asia/Singapore" ${settings.timezone === "Asia/Singapore" ? "selected" : ""}>Singapore (Asia/Singapore)</option>
                        <option value="Asia/Bangkok" ${settings.timezone === "Asia/Bangkok" ? "selected" : ""}>Thailand (Asia/Bangkok)</option>
                        <option value="Asia/Kolkata" ${settings.timezone === "Asia/Kolkata" ? "selected" : ""}>India (Asia/Kolkata)</option>
                        <option value="Asia/Karachi" ${settings.timezone === "Asia/Karachi" ? "selected" : ""}>Pakistan (Asia/Karachi)</option>
                        <option value="Asia/Jakarta" ${settings.timezone === "Asia/Jakarta" ? "selected" : ""}>Indonesia (Asia/Jakarta)</option>
                        <option value="Asia/Manila" ${settings.timezone === "Asia/Manila" ? "selected" : ""}>Philippines (Asia/Manila)</option>
                        <option value="Asia/Kuala_Lumpur" ${settings.timezone === "Asia/Kuala_Lumpur" ? "selected" : ""}>Malaysia (Asia/Kuala_Lumpur)</option>
                        <option value="Asia/Taipei" ${settings.timezone === "Asia/Taipei" ? "selected" : ""}>Taiwan (Asia/Taipei)</option>
                        <option value="Asia/Yekaterinburg" ${settings.timezone === "Asia/Yekaterinburg" ? "selected" : ""}>Russia Yekaterinburg (Asia/Yekaterinburg)</option>
                        <option value="Australia/Sydney" ${settings.timezone === "Australia/Sydney" ? "selected" : ""}>Australia East (Australia/Sydney)</option>
                        <option value="Australia/Melbourne" ${settings.timezone === "Australia/Melbourne" ? "selected" : ""}>Australia Melbourne (Australia/Melbourne)</option>
                        <option value="Australia/Brisbane" ${settings.timezone === "Australia/Brisbane" ? "selected" : ""}>Australia Brisbane (Australia/Brisbane)</option>
                        <option value="Australia/Adelaide" ${settings.timezone === "Australia/Adelaide" ? "selected" : ""}>Australia Adelaide (Australia/Adelaide)</option>
                        <option value="Australia/Perth" ${settings.timezone === "Australia/Perth" ? "selected" : ""}>Australia West (Australia/Perth)</option>
                        <option value="Pacific/Auckland" ${settings.timezone === "Pacific/Auckland" ? "selected" : ""}>New Zealand (Pacific/Auckland)</option>
                        <option value="Pacific/Fiji" ${settings.timezone === "Pacific/Fiji" ? "selected" : ""}>Fiji (Pacific/Fiji)</option>
                        <option value="Pacific/Guam" ${settings.timezone === "Pacific/Guam" ? "selected" : ""}>Guam (Pacific/Guam)</option>
                    </select>
                    <p class="setting-help" style="margin-left: -3ch !important;">Set your timezone for accurate time display in logs and scheduling. Changes are applied immediately.</p>
                </div>
            </div>

            <div class="settings-group" style="
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
                border: 2px solid rgba(90, 109, 137, 0.3);
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0 25px 0;
                box-shadow: 0 4px 12px rgba(90, 109, 137, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            ">
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
            
            <div class="settings-group" style="
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
                border: 2px solid rgba(90, 109, 137, 0.3);
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0 25px 0;
                box-shadow: 0 4px 12px rgba(90, 109, 137, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            ">
                <h3>Advanced Settings</h3>
                <div class="setting-item">
                    <label for="base_url">Base URL:</label>
                    <input type="text" id="base_url" value="${settings.base_url || ""}" placeholder="/huntarr">
                    <p class="setting-help" style="margin-left: -3ch !important;">Base URL path for reverse proxy. Requires restart.</p>
                </div>
                <div class="setting-item">
                    <label for="dev_key">Huntarr Dev Key:</label>
                    <input type="password" id="dev_key" value="${settings.dev_key || ""}" placeholder="Enter dev key" style="width: 300px; padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1); background-color: #1f2937; color: #d1d5db;">
                    <p class="setting-help" style="margin-left: -3ch !important;">Enter development key to enable dev mode.</p>
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
                    <span class="setting-help" style="margin: 0; color: #64748b;">${(settings.dev_mode === true) ? "Dev mode enabled." : "Valid key + save to enable."}</span>
                </div>
            </div>

            <div class="settings-group" style="
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
                border: 2px solid rgba(90, 109, 137, 0.3);
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0 25px 0;
                box-shadow: 0 4px 12px rgba(90, 109, 137, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            ">
                <h3>Display Settings</h3>
                <div class="setting-item">
                    <label for="tmdb_image_cache_days"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#tmdb-image-cache" class="info-icon" title="Learn more about TMDB image caching" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>TMDB Image Cache:</label>
                    <select id="tmdb_image_cache_days" class="control-select" style="width: 200px;">
                        <option value="0" ${settings.tmdb_image_cache_days === 0 ? "selected" : ""}>Disabled (Always Load)</option>
                        <option value="1" ${settings.tmdb_image_cache_days === 1 ? "selected" : ""}>1 Day</option>
                        <option value="7" ${(settings.tmdb_image_cache_days === 7 || settings.tmdb_image_cache_days === undefined) ? "selected" : ""}>7 Days</option>
                        <option value="30" ${settings.tmdb_image_cache_days === 30 ? "selected" : ""}>30 Days</option>
                    </select>
                    <p class="setting-help" style="margin-left: -3ch !important;">Cache TMDB images to reduce load times and API usage. Missing images will still attempt to load. Set to "Disabled" to always fetch fresh images.</p>
                </div>
                <div class="setting-item">
                    <label for="tmdb_cache_storage"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#tmdb-cache-storage" class="info-icon" title="Learn more about cache storage location" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Cache Storage Location:</label>
                    <select id="tmdb_cache_storage" class="control-select" style="width: 200px;" ${settings.tmdb_image_cache_days === 0 ? "disabled" : ""}>
                        <option value="server" ${(settings.tmdb_cache_storage === "server" || settings.tmdb_cache_storage === undefined) ? "selected" : ""}>Server-Side (Shared)</option>
                        <option value="browser" ${settings.tmdb_cache_storage === "browser" ? "selected" : ""}>Browser-Side (Per User)</option>
                    </select>
                    <p class="setting-help" style="margin-left: -3ch !important;">Server-Side: Images cached on Huntarr server, shared across all users. Browser-Side: Images cached in each user's browser localStorage.</p>
                </div>
                <div class="setting-item">
                    <label for="enable_requestarr">Enable Requestarr:</label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="enable_requestarr" ${
                          settings.enable_requestarr !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help" style="margin-left: -3ch !important;">Show Requestarr in the menu and enable discover/trending on the home page. When disabled, Requestarr is hidden and no TMDB/trending APIs are called.</p>
                </div>
                <div class="setting-item" id="show_trending_setting_item">
                    <label for="show_trending"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#show-trending" class="info-icon" title="Learn more about rotating discover content on home page" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Show Discover Content:</label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="show_trending" ${
                          settings.show_trending === true ? "checked" : ""
                        } ${settings.enable_requestarr === false ? "disabled" : ""}>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help" style="margin-left: -3ch !important;">Display rotating discover content on the home page (Trending This Week, Popular Movies, Popular TV Shows). Requires Requestarr to be enabled.</p>
                </div>
                <div class="setting-item">
                    <label for="low_usage_mode"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#low-usage-mode" class="info-icon" title="Learn more about Low Usage Mode" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Low Usage Mode:</label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="low_usage_mode" ${
                          settings.low_usage_mode === true ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help" style="margin-left: -3ch !important;">Disables animations to reduce CPU/GPU usage on older devices</p>
                </div>
            </div>
        `;

        if (window.SettingsForms.setupSettingsManualSave) {
            window.SettingsForms.setupSettingsManualSave(container, settings);
        }

        // When Enable Requestarr is toggled, disable Show Discover Content when Requestarr is off
        const enableRequestarrEl = container.querySelector('#enable_requestarr');
        const showTrendingEl = container.querySelector('#show_trending');
        if (enableRequestarrEl && showTrendingEl) {
            const updateShowTrendingDisabled = () => {
                showTrendingEl.disabled = !enableRequestarrEl.checked;
                if (!enableRequestarrEl.checked) showTrendingEl.checked = false;
            };
            enableRequestarrEl.addEventListener('change', updateShowTrendingDisabled);
            updateShowTrendingDisabled();
        }
        
        // When TMDB cache is disabled, disable the storage location selector
        const cacheDaysEl = container.querySelector('#tmdb_image_cache_days');
        const cacheStorageEl = container.querySelector('#tmdb_cache_storage');
        if (cacheDaysEl && cacheStorageEl) {
            const updateCacheStorageDisabled = () => {
                const isDisabled = cacheDaysEl.value === '0';
                cacheStorageEl.disabled = isDisabled;
                if (isDisabled) {
                    cacheStorageEl.style.opacity = '0.5';
                    cacheStorageEl.style.cursor = 'not-allowed';
                } else {
                    cacheStorageEl.style.opacity = '1';
                    cacheStorageEl.style.cursor = 'pointer';
                }
            };
            cacheDaysEl.addEventListener('change', updateCacheStorageDisabled);
            updateCacheStorageDisabled();
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

            const settings = window.SettingsForms.getFormSettings(container, "general");
            window.SettingsForms.saveAppSettings("general", settings, "Settings saved successfully", { section: "main" });

            if (liveBtn) liveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            updateSaveButtonState(false);
        });
    };
})();
