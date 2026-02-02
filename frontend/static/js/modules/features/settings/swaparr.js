(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateSwaparrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "swaparr");

        let html = `
            <div style="margin-bottom: 25px;">
                <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                    <button type="button" id="swaparr-save-button" disabled style="
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
                    
                    <div style="margin-left: auto; display: flex; gap: 10px;">
                        <a href="https://github.com/ThijmenGThN/swaparr" target="_blank" rel="noopener" style="
                            background: linear-gradient(135deg, #24292e 0%, #161b22 100%);
                            color: #f0f6fc;
                            border: 1px solid #30363d;
                            padding: 8px 16px;
                            border-radius: 6px;
                            font-size: 14px;
                            font-weight: 500;
                            text-decoration: none;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            transition: all 0.2s ease;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                            <i class="fab fa-github" style="font-size: 16px;"></i>
                            View on GitHub
                        </a>
                        
                        <a href="https://github.com/ThijmenGThN/swaparr/stargazers" target="_blank" rel="noopener" style="
                            background: linear-gradient(135deg, #f1c40f 0%, #f39c12 100%);
                            color: #fff;
                            border: 1px solid #d35400;
                            padding: 8px 16px;
                            border-radius: 6px;
                            font-size: 14px;
                            font-weight: 600;
                            text-decoration: none;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            transition: all 0.2s ease;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
                        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                            <i class="fas fa-star" style="margin-right: 4px;"></i>
                            <span id="swaparr-stars-count">Loading...</span>
                        </a>
                    </div>
                </div>
                
                <!-- Advanced Options Notice -->
                <div style="
                    background: linear-gradient(135deg, #164e63 0%, #0e7490 50%, #0891b2 100%);
                    border: 1px solid #22d3ee;
                    border-radius: 6px;
                    padding: 10px;
                    margin: 10px 0 15px 0;
                    box-shadow: 0 2px 8px rgba(34, 211, 238, 0.1);
                ">
                    <p style="color: #e0f7fa; margin: 0; font-size: 0.8em; line-height: 1.4;">
                        <i class="fas fa-rocket" style="margin-right: 6px; color: #22d3ee;"></i>
                        <strong>Need Advanced Options?</strong> For enhanced control and features, we recommend 
                        <a href="https://github.com/flmorg/cleanuperr" target="_blank" rel="noopener" style="color: #fbbf24; text-decoration: none; font-weight: 600;">
                            <strong>Cleanuperr</strong>
                        </a> which offers more comprehensive management capabilities.
                    </p>
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
                <h3>Swaparr Configuration</h3>
                <p class="setting-help" style="margin-bottom: 20px; color: #9ca3af;">
                    Swaparr monitors your *arr applications' download queues and removes stalled downloads automatically.
                </p>
                
                <div class="setting-item">
                    <label for="swaparr_enabled">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#enable-swaparr" class="info-icon" title="Enable or disable Swaparr" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Enable Swaparr:
                    </label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="swaparr_enabled" ${
                          settings.enabled === true ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Enable automatic removal of stalled downloads</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_max_strikes">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#max-strikes" class="info-icon" title="Number of strikes before removal" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Max Strikes:
                    </label>
                    <input type="number" id="swaparr_max_strikes" min="1" max="10" value="${
                      settings.max_strikes || 3
                    }">
                    <p class="setting-help">Number of strikes a download gets before being removed (default: 3)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_max_download_time">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#max-download-time" class="info-icon" title="Maximum time before considering download stalled" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Max Download Time:
                    </label>
                    <input type="text" id="swaparr_max_download_time" value="${
                      settings.max_download_time || "2h"
                    }" placeholder="e.g., 2h, 120m, 7200s">
                    <p class="setting-help">Maximum time before considering a download stalled (examples: 2h, 120m, 7200s)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_ignore_above_size">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#ignore-above-size" class="info-icon" title="Ignore downloads larger than this size" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Ignore Above Size:
                    </label>
                    <input type="text" id="swaparr_ignore_above_size" value="${
                      settings.ignore_above_size || "25GB"
                    }" placeholder="e.g., 25GB, 10GB, 5000MB">
                    <p class="setting-help">Ignore downloads larger than this size (examples: 25GB, 10GB, 5000MB)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_remove_from_client">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#remove-from-client" class="info-icon" title="Remove downloads from download client" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Remove from Client:
                    </label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="swaparr_remove_from_client" ${
                          settings.remove_from_client !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Also remove downloads from the download client (recommended: enabled)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_research_removed">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#research-removed" class="info-icon" title="Automatically blocklist and re-search removed downloads" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Re-Search Removed Download:
                    </label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="swaparr_research_removed" ${
                          settings.research_removed === true ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">When a download is removed, blocklist it in the *arr app and automatically search for alternatives (retry once)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_failed_import_detection">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#failed-import-detection" class="info-icon" title="Automatically handle failed imports" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Handle Failed Imports:
                    </label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="swaparr_failed_import_detection" ${
                          settings.failed_import_detection === true
                            ? "checked"
                            : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Automatically detect failed imports, blocklist them, and search for alternatives</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_dry_run">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#dry-run-mode" class="info-icon" title="Test mode - no actual removals" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Dry Run Mode:
                    </label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="swaparr_dry_run" ${
                          settings.dry_run === true ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Test mode - logs what would be removed without actually removing anything</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_ignore_usenet_queued">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#ignore-usenet-queued" class="info-icon" title="Ignore queued usenet downloads with 0% progress" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Ignore Queued Usenet:
                    </label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="swaparr_ignore_usenet_queued" ${
                          settings.ignore_usenet_queued !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Ignore usenet downloads with 0% progress to avoid false positives from sequential queue ETAs (recommended: enabled)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_sleep_duration">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#sleep-duration" class="info-icon" title="Time between Swaparr cycles" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Sleep Duration (Minutes):
                    </label>
                    <div class="input-group" style="display: flex; align-items: center; gap: 10px;">
                        <input type="number" id="swaparr_sleep_duration" value="${
                          settings.sleep_duration
                            ? Math.round(settings.sleep_duration / 60)
                            : 15
                        }" min="10" max="1440" style="width: 120px;">
                        <span style="color: #9ca3af; font-size: 14px;">minutes</span>
                    </div>
                    <p class="setting-help">Time to wait between Swaparr processing cycles (minimum 10 minutes, default: 15 minutes)</p>
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
                <h3>Security Features</h3>
                <p class="setting-help" style="margin-bottom: 20px; color: #9ca3af;">
                    Advanced security features to protect your system from malicious downloads and suspicious content by analyzing download names and titles. Detection is based on filename patterns, not file contents.
                </p>
                
                <div class="setting-item">
                    <label for="swaparr_malicious_detection">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#malicious-file-detection" class="info-icon" title="Enable malicious file detection" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Malicious File Detection:
                    </label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="swaparr_malicious_detection" ${
                          settings.malicious_file_detection === true
                            ? "checked"
                            : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Automatically detect and immediately remove downloads with malicious file types</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_malicious_extensions_input">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#malicious-extensions" class="info-icon" title="File extensions to consider malicious" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Malicious File Extensions:
                    </label>
                    <div class="tag-input-container">
                        <div class="tag-list" id="swaparr_malicious_extensions_tags"></div>
                        <div class="tag-input-wrapper">
                            <input type="text" id="swaparr_malicious_extensions_input" placeholder="Type extension and press Enter (e.g. .lnk)" class="tag-input">
                            <button type="button" class="tag-add-btn" onclick="window.SettingsForms.addExtensionTag()">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <p class="setting-help">File extensions to block. Type extension and press Enter or click +. Examples: .lnk, .exe, .bat, .zipx</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_suspicious_patterns_input">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#suspicious-patterns" class="info-icon" title="Suspicious filename patterns" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Suspicious Patterns:
                    </label>
                    <div class="tag-input-container">
                        <div class="tag-list" id="swaparr_suspicious_patterns_tags"></div>
                        <div class="tag-input-wrapper">
                            <input type="text" id="swaparr_suspicious_patterns_input" placeholder="Type pattern and press Enter (e.g. keygen)" class="tag-input">
                            <button type="button" class="tag-add-btn" onclick="window.SettingsForms.addPatternTag()">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <p class="setting-help">Filename patterns to block. Type pattern and press Enter or click +. Examples: password.txt, keygen, crack</p>
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
                <h3>Age-Based Cleanup</h3>
                <p class="setting-help" style="margin-bottom: 20px; color: #9ca3af;">
                    Automatically remove downloads that have been stuck for too long, regardless of strike count.
                </p>
                
                <div class="setting-item">
                    <label for="swaparr_age_based_removal">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#age-based-removal" class="info-icon" title="Enable age-based removal" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Enable Age-Based Removal:
                    </label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="swaparr_age_based_removal" ${
                          settings.age_based_removal === true ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Remove downloads that have been stuck longer than the specified age limit</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_max_age_days">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#max-age-days" class="info-icon" title="Maximum age before removal" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Maximum Age (Days):
                    </label>
                    <input type="number" id="swaparr_max_age_days" min="1" max="30" value="${
                      settings.max_age_days || 7
                    }">
                    <p class="setting-help">Remove downloads older than this many days (default: 7 days)</p>
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
                <h3>Quality-Based Filtering</h3>
                <p class="setting-help" style="margin-bottom: 20px; color: #9ca3af;">
                    Automatically remove downloads with poor or undesirable quality indicators in their names.
                </p>
                
                <div class="setting-item">
                    <label for="swaparr_quality_based_removal">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#quality-based-removal" class="info-icon" title="Enable quality-based filtering" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Enable Quality-Based Filtering:
                    </label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="swaparr_quality_based_removal" ${
                          settings.quality_based_removal === true
                            ? "checked"
                            : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Automatically remove downloads with blocked quality patterns in their names</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_quality_patterns_input">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#blocked-quality-patterns" class="info-icon" title="Quality patterns to block" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Blocked Quality Patterns:
                    </label>
                    <div class="tag-input-container">
                        <div class="tag-list" id="swaparr_quality_patterns_tags"></div>
                        <div class="tag-input-wrapper">
                            <input type="text" id="swaparr_quality_patterns_input" placeholder="Type quality pattern and press Enter (e.g. cam)" class="tag-input">
                            <button type="button" class="tag-add-btn" onclick="window.SettingsForms.addQualityTag()">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <p class="setting-help">Quality patterns to block. Type pattern and press Enter or click +. Examples: cam, ts, hdcam, workprint</p>
                </div>
            </div>

        `;

        container.innerHTML = html;

        window.SettingsForms.loadSwaparrStarCount();
        window.SettingsForms.initializeTagSystem(settings);

        const swaparrEnabledToggle = container.querySelector("#swaparr_enabled");
        if (swaparrEnabledToggle) {
            swaparrEnabledToggle.addEventListener("change", () => {
                if (window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings.swaparr) {
                    window.huntarrUI.originalSettings.swaparr.enabled = swaparrEnabledToggle.checked;
                }

                try {
                    const cachedSettings = localStorage.getItem("huntarr-settings-cache");
                    if (cachedSettings) {
                        const settings = JSON.parse(cachedSettings);
                        if (!settings.swaparr) settings.swaparr = {};
                        settings.swaparr.enabled = swaparrEnabledToggle.checked;
                        localStorage.setItem("huntarr-settings-cache", JSON.stringify(settings));
                    }
                } catch (e) {
                    console.warn("[SettingsForms] Failed to update cached settings:", e);
                }

                if (window.SettingsForms.updateSwaparrFieldsDisabledState) {
                    window.SettingsForms.updateSwaparrFieldsDisabledState();
                }
            });

            setTimeout(() => {
                if (window.SettingsForms.updateSwaparrFieldsDisabledState) {
                    window.SettingsForms.updateSwaparrFieldsDisabledState();
                }
            }, 100);
        }

        if (window.SettingsForms.setupSwaparrManualSave) {
            window.SettingsForms.setupSwaparrManualSave(container, settings);
        }
    };

    window.SettingsForms.loadSwaparrStarCount = function() {
        const starsElement = document.getElementById("swaparr-stars-count");
        if (!starsElement) return;

        const cachedData = localStorage.getItem("swaparr-github-stars");
        if (cachedData) {
            try {
                const parsed = JSON.parse(cachedData);
                if (parsed.stars !== undefined) {
                    starsElement.textContent = parsed.stars.toLocaleString();
                    const cacheAge = Date.now() - (parsed.timestamp || 0);
                    if (cacheAge < 3600000) {
                        return;
                    }
                }
            } catch (e) {
                console.warn("Invalid cached Swaparr star data, will fetch fresh");
                localStorage.removeItem("swaparr-github-stars");
            }
        }

        starsElement.textContent = "Loading...";

        const apiUrl = "https://api.github.com/repos/ThijmenGThN/swaparr";

        HuntarrUtils.fetchWithTimeout(apiUrl)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`GitHub API error: ${response.status}`);
                }
                return response.json();
            })
            .then((data) => {
                if (data && data.stargazers_count !== undefined) {
                    const formattedStars = data.stargazers_count.toLocaleString();
                    starsElement.textContent = formattedStars;

                    const cacheData = {
                        stars: data.stargazers_count,
                        timestamp: Date.now(),
                    };
                    localStorage.setItem("swaparr-github-stars", JSON.stringify(cacheData));
                }
            })
            .catch((error) => {
                console.warn("Failed to fetch Swaparr stars:", error);
                if (starsElement.textContent === "Loading...") {
                    starsElement.textContent = "Unknown";
                }
            });
    };

    window.SettingsForms.initializeTagSystem = function(settings) {
        const defaultExtensions = [".lnk", ".exe", ".bat", ".cmd", ".scr", ".pif", ".com", ".zipx", ".jar", ".vbs", ".js", ".jse", ".wsf", ".wsh"];
        const extensions = settings.malicious_extensions || defaultExtensions;
        window.SettingsForms.loadTags("swaparr_malicious_extensions_tags", extensions);

        const defaultPatterns = ["password.txt", "readme.txt", "install.exe", "setup.exe", "keygen", "crack", "patch.exe", "activator"];
        const patterns = settings.suspicious_patterns || defaultPatterns;
        window.SettingsForms.loadTags("swaparr_suspicious_patterns_tags", patterns);

        const defaultQualityPatterns = ["cam", "camrip", "hdcam", "ts", "telesync", "tc", "telecine", "r6", "dvdscr", "dvdscreener", "workprint", "wp"];
        const qualityPatterns = settings.blocked_quality_patterns || defaultQualityPatterns;
        window.SettingsForms.loadTags("swaparr_quality_patterns_tags", qualityPatterns);

        const extensionInput = document.getElementById("swaparr_malicious_extensions_input");
        const patternInput = document.getElementById("swaparr_suspicious_patterns_input");
        const qualityInput = document.getElementById("swaparr_quality_patterns_input");

        if (extensionInput) {
            extensionInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    window.SettingsForms.addExtensionTag();
                }
            });
        }

        if (patternInput) {
            patternInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    window.SettingsForms.addPatternTag();
                }
            });
        }

        if (qualityInput) {
            qualityInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    window.SettingsForms.addQualityTag();
                }
            });
        }

        // Expose helper functions globally if needed by inline onclicks, though we prefer window.SettingsForms
        // The inline onclicks in HTML above use window.SettingsForms.add*Tag()
    };

    window.SettingsForms.loadTags = function(containerId, tags) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = "";
        tags.forEach((tag) => {
            window.SettingsForms.createTagElement(container, tag);
        });
    };

    window.SettingsForms.createTagElement = function(container, text) {
        const tagDiv = document.createElement("div");
        tagDiv.className = "tag-item";
        tagDiv.innerHTML = `
            <span class="tag-text">${text}</span>
            <button type="button" class="tag-remove" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        container.appendChild(tagDiv);
    };

    window.SettingsForms.addExtensionTag = function() {
        const input = document.getElementById("swaparr_malicious_extensions_input");
        const container = document.getElementById("swaparr_malicious_extensions_tags");

        if (!input || !container) return;

        let value = input.value.trim();
        if (!value) return;

        if (!value.startsWith(".")) {
            value = "." + value;
        }

        const existing = Array.from(container.querySelectorAll(".tag-text")).map((el) => el.textContent);
        if (existing.includes(value)) {
            input.value = "";
            return;
        }

        window.SettingsForms.createTagElement(container, value);
        input.value = "";
    };

    window.SettingsForms.addPatternTag = function() {
        const input = document.getElementById("swaparr_suspicious_patterns_input");
        const container = document.getElementById("swaparr_suspicious_patterns_tags");

        if (!input || !container) return;

        const value = input.value.trim();
        if (!value) return;

        const existing = Array.from(container.querySelectorAll(".tag-text")).map((el) => el.textContent);
        if (existing.includes(value)) {
            input.value = "";
            return;
        }

        window.SettingsForms.createTagElement(container, value);
        input.value = "";
    };

    window.SettingsForms.addQualityTag = function() {
        const input = document.getElementById("swaparr_quality_patterns_input");
        const container = document.getElementById("swaparr_quality_patterns_tags");

        if (!input || !container) return;

        const value = input.value.trim().toLowerCase();
        if (!value) return;

        const existing = Array.from(container.querySelectorAll(".tag-text")).map((el) => el.textContent.toLowerCase());
        if (existing.includes(value)) {
            input.value = "";
            return;
        }

        window.SettingsForms.createTagElement(container, value);
        input.value = "";
    };

    window.SettingsForms.setupSwaparrManualSave = function(container, originalSettings = {}) {
        const saveButton = container.querySelector("#swaparr-save-button");
        if (!saveButton) return;

        saveButton.disabled = true;
        saveButton.style.background = "#6b7280";
        saveButton.style.color = "#9ca3af";
        saveButton.style.borderColor = "#4b5563";
        saveButton.style.cursor = "not-allowed";

        let hasChanges = false;
        window.swaparrUnsavedChanges = false;
        if (window.SettingsForms.removeUnsavedChangesWarning) {
            window.SettingsForms.removeUnsavedChangesWarning();
        }

        const updateSaveButtonState = (changesDetected) => {
            hasChanges = changesDetected;
            window.swaparrUnsavedChanges = changesDetected;
            const btn = container.querySelector("#swaparr-save-button");
            if (!btn) return;

            if (hasChanges) {
                btn.disabled = false;
                btn.style.background = "#dc2626";
                btn.style.color = "#ffffff";
                btn.style.borderColor = "#dc2626";
                btn.style.cursor = "pointer";
                if (window.SettingsForms.addUnsavedChangesWarning) {
                    window.SettingsForms.addUnsavedChangesWarning();
                }
            } else {
                btn.disabled = true;
                btn.style.background = "#6b7280";
                btn.style.color = "#9ca3af";
                btn.style.borderColor = "#4b5563";
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

            newSaveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            newSaveButton.disabled = true;

            // Collect data
            const settings = { ...originalSettings };
            
            const enabled = document.getElementById("swaparr_enabled");
            if (enabled) settings.enabled = enabled.checked;

            const maxStrikes = document.getElementById("swaparr_max_strikes");
            if (maxStrikes) settings.max_strikes = parseInt(maxStrikes.value);

            const maxDownloadTime = document.getElementById("swaparr_max_download_time");
            if (maxDownloadTime) settings.max_download_time = maxDownloadTime.value;

            const ignoreAboveSize = document.getElementById("swaparr_ignore_above_size");
            if (ignoreAboveSize) settings.ignore_above_size = ignoreAboveSize.value;

            const removeFromClient = document.getElementById("swaparr_remove_from_client");
            if (removeFromClient) settings.remove_from_client = removeFromClient.checked;

            const researchRemoved = document.getElementById("swaparr_research_removed");
            if (researchRemoved) settings.research_removed = researchRemoved.checked;

            const failedImport = document.getElementById("swaparr_failed_import_detection");
            if (failedImport) settings.failed_import_detection = failedImport.checked;

            const dryRun = document.getElementById("swaparr_dry_run");
            if (dryRun) settings.dry_run = dryRun.checked;

            const ignoreUsenetQueued = document.getElementById("swaparr_ignore_usenet_queued");
            if (ignoreUsenetQueued) settings.ignore_usenet_queued = ignoreUsenetQueued.checked;

            const sleepDuration = document.getElementById("swaparr_sleep_duration");
            if (sleepDuration) settings.sleep_duration = parseInt(sleepDuration.value) * 60;

            const malicious = document.getElementById("swaparr_malicious_detection");
            if (malicious) settings.malicious_file_detection = malicious.checked;

            const ageRemoval = document.getElementById("swaparr_age_based_removal");
            if (ageRemoval) settings.age_based_removal = ageRemoval.checked;

            const maxAge = document.getElementById("swaparr_max_age_days");
            if (maxAge) settings.max_age_days = parseInt(maxAge.value);

            const qualityRemoval = document.getElementById("swaparr_quality_based_removal");
            if (qualityRemoval) settings.quality_based_removal = qualityRemoval.checked;

            // Collect tags
            const getTags = (id) => {
                const container = document.getElementById(id);
                if (!container) return [];
                return Array.from(container.querySelectorAll(".tag-text")).map(el => el.textContent);
            };

            settings.malicious_extensions = getTags("swaparr_malicious_extensions_tags");
            settings.suspicious_patterns = getTags("swaparr_suspicious_patterns_tags");
            settings.blocked_quality_patterns = getTags("swaparr_quality_patterns_tags");

            // Save
            window.SettingsForms.saveAppSettings("swaparr", settings);
            
            // Reset UI state
            newSaveButton.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            updateSaveButtonState(false);
        });
    };
})();
