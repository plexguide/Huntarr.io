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

        let instancesHtml = `
            <div class="settings-group">
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

        // Sleep Duration and API Cap are now per-instance (configure in each instance's Edit) - no save button needed
        container.innerHTML = instancesHtml;

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
