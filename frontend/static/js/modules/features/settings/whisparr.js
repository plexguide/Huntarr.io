(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateWhisparrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        const wasSuppressionActive = window._appsSuppressChangeDetection;
        window._appsSuppressChangeDetection = true;

        container.setAttribute("data-app-type", "whisparr");

        if (!settings.instances || !Array.isArray(settings.instances)) {
            settings.instances = [];
        }

        let instancesHtml = `
            <div class="settings-group" style="
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
                border: 2px solid rgba(90, 109, 137, 0.3);
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0 25px 0;
                box-shadow: 0 4px 12px rgba(90, 109, 137, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            ">
                <h3>Whisparr V2 Instances</h3>
                <div class="instance-card-grid" id="whisparr-instances-grid">
        `;

        if (settings.instances && settings.instances.length > 0) {
            settings.instances.forEach((instance, index) => {
                instancesHtml += window.SettingsForms.renderInstanceCard('whisparr', instance, index);
            });
        }

        instancesHtml += `
            <div class="add-instance-card" data-app-type="whisparr">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Whisparr Instance</div>
            </div>
        `;

        instancesHtml += `
                </div>
            </div>
        `;

        // Sleep Duration and API Cap are now per-instance (configure in each instance's Edit) - no save button needed
        container.innerHTML = instancesHtml;

        const grid = container.querySelector('#whisparr-instances-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-card.edit');
                const deleteBtn = e.target.closest('.btn-card.delete');
                const addCard = e.target.closest('.add-instance-card');

                if (editBtn) {
                    const appType = editBtn.dataset.appType;
                    const index = parseInt(editBtn.dataset.instanceIndex);
                    window.SettingsForms.openInstanceModal(appType, index);
                } else if (deleteBtn) {
                    const appType = deleteBtn.dataset.appType;
                    const index = parseInt(deleteBtn.dataset.instanceIndex);
                    window.SettingsForms.deleteInstance(appType, index);
                } else if (addCard) {
                    const appType = addCard.dataset.appType;
                    window.SettingsForms.openInstanceModal(appType);
                }
            });
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("whisparr");
            }
        }, 100);

        setTimeout(() => {
            // Always enable change detection after form is fully loaded
            window._appsSuppressChangeDetection = false;
        }, 100);
    };

    window.SettingsForms.generateErosForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        const wasSuppressionActive = window._appsSuppressChangeDetection;
        window._appsSuppressChangeDetection = true;

        container.setAttribute("data-app-type", "eros");

        if (!settings.instances || !Array.isArray(settings.instances)) {
            settings.instances = [];
        }

        let instancesHtml = `
            <div class="settings-group" style="
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
                border: 2px solid rgba(90, 109, 137, 0.3);
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0 25px 0;
                box-shadow: 0 4px 12px rgba(90, 109, 137, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            ">
                <h3>Whisparr V3 Instances</h3>
                <div class="instance-card-grid" id="eros-instances-grid">
        `;

        if (settings.instances && settings.instances.length > 0) {
            settings.instances.forEach((instance, index) => {
                instancesHtml += window.SettingsForms.renderInstanceCard('eros', instance, index);
            });
        }

        instancesHtml += `
            <div class="add-instance-card" data-app-type="eros">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Whisparr V3 Instance</div>
            </div>
        `;

        instancesHtml += `
                </div>
            </div>
        `;

        let searchSettingsHtml = `
            <div class="settings-group">
                <h3>Search Settings</h3>
                <div class="setting-item">
                    <label for="eros_search_mode"><a href="https://plexguide.github.io/Huntarr.io/apps/eros.html#search-mode" class="info-icon" title="Learn more about search modes" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Search Mode:</label>
                    <select id="eros_search_mode" name="search_mode">
                        <option value="movie" ${settings.search_mode === "movie" || !settings.search_mode ? "selected" : ""}>Movie</option>
                        <option value="scene" ${settings.search_mode === "scene" ? "selected" : ""}>Scene</option>
                    </select>
                    <p class="setting-help">How to search for missing and upgradable Whisparr V3 content (Movie-based or Scene-based)</p>
                </div>

            </div>
        `;

        container.innerHTML = instancesHtml + searchSettingsHtml;

        const grid = container.querySelector('#eros-instances-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-card.edit');
                const deleteBtn = e.target.closest('.btn-card.delete');
                const addCard = e.target.closest('.add-instance-card');

                if (editBtn) {
                    const appType = editBtn.dataset.appType;
                    const index = parseInt(editBtn.dataset.instanceIndex);
                    window.SettingsForms.openInstanceModal(appType, index);
                } else if (deleteBtn) {
                    const appType = deleteBtn.dataset.appType;
                    const index = parseInt(deleteBtn.dataset.instanceIndex);
                    window.SettingsForms.deleteInstance(appType, index);
                } else if (addCard) {
                    const appType = addCard.dataset.appType;
                    window.SettingsForms.openInstanceModal(appType);
                }
            });
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("eros");
            }
        }, 100);

        setTimeout(() => {
            // Always enable change detection after form is fully loaded
            window._appsSuppressChangeDetection = false;
        }, 100);
    };
})();
