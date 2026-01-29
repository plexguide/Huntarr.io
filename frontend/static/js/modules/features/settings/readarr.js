(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateReadarrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        const wasSuppressionActive = window._appsSuppressChangeDetection;
        window._appsSuppressChangeDetection = true;

        container.setAttribute("data-app-type", "readarr");

        if (!settings.instances || !Array.isArray(settings.instances)) {
            settings.instances = [];
        }

        let readarrSaveButtonHtml = `
            <div style="margin-bottom: 20px;">
                <button type="button" id="readarr-save-button" disabled style="
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

        let instancesHtml = `
            <div class="settings-group" style="
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
                border: 2px solid rgba(90, 109, 137, 0.3);
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0 25px 0;
                box-shadow: 0 4px 12px rgba(90, 109, 137, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            ">
                <h3>Readarr Instances</h3>
                <div class="instance-card-grid" id="readarr-instances-grid">
        `;

        if (settings.instances && settings.instances.length > 0) {
            settings.instances.forEach((instance, index) => {
                instancesHtml += window.SettingsForms.renderInstanceCard('readarr', instance, index);
            });
        }

        instancesHtml += `
            <div class="add-instance-card" data-app-type="readarr">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Readarr Instance</div>
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
                    <label for="readarr_sleep_duration"><a href="https://plexguide.github.io/Huntarr.io/apps/readarr.html#search-settings" class="info-icon" title="Learn more about sleep duration" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Sleep Duration (Minutes):</label>
                    <input type="number" id="readarr_sleep_duration" name="sleep_duration" min="10" value="${
                        settings.sleep_duration !== undefined ? Math.round(settings.sleep_duration / 60) : 15
                    }">
                    <p class="setting-help">Time in minutes between processing cycles (minimum 10 minutes)</p>
                </div>
                <div class="setting-item">
                    <label for="readarr_hourly_cap"><a href="https://plexguide.github.io/Huntarr.io/apps/readarr.html#search-settings" class="info-icon" title="Maximum API requests per hour for this app (20 is safe)" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>API Cap - Hourly:</label>
                    <input type="number" id="readarr_hourly_cap" name="hourly_cap" min="1" max="400" value="${
                        settings.hourly_cap !== undefined ? settings.hourly_cap : 20
                    }">
                    <p class="setting-help">Maximum API requests per hour to prevent being banned by your indexers. Keep lower for safety (20-50 recommended). Max allowed: 400.</p>
                </div>
            </div>
        `;

        container.innerHTML = readarrSaveButtonHtml + instancesHtml + searchSettingsHtml;

        const grid = container.querySelector('#readarr-instances-grid');
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

        if (window.SettingsForms.setupAppManualSave) {
            window.SettingsForms.setupAppManualSave(container, "readarr", settings);
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("readarr");
            }
        }, 100);

        setTimeout(() => {
            // Always enable change detection after form is fully loaded
            window._appsSuppressChangeDetection = false;
        }, 100);
    };
})();
