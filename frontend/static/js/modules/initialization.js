/**
 * Initialization Module
 * Handles dynamic loading and initialization of UI sections
 */

window.HuntarrInit = {
    initializeLogsSettings: function() {
        console.log('[HuntarrInit] initializeLogsSettings called');
        const container = document.getElementById('logsSettingsContainer');
        if (!container) return;
        
        const currentContent = container.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Content will be loaded here -->')) return;
        
        container.innerHTML = '<div class="loading-spinner" style="text-align: center; padding: 20px;"><i class="fas fa-circle-notch fa-spin"></i> Loading settings...</div>';
        
        HuntarrUtils.fetchWithTimeout('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.huntarrUI) window.huntarrUI.originalSettings.general = settings.general;
                const generalSettings = settings.general || {};
                
                if (window.SettingsForms && typeof window.SettingsForms.generateLogsSettingsForm === 'function') {
                    container.innerHTML = '';
                    window.SettingsForms.generateLogsSettingsForm(container, generalSettings);
                } else {
                    container.innerHTML = '<p class="error-message">Error loading form generator.</p>';
                }
            })
            .catch(error => {
                console.error('[HuntarrInit] Error loading settings for logs:', error);
                container.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
            });
    },

    initializeSettings: function() {
        console.log('[HuntarrInit] initializeSettings called');
        const generalSettings = document.getElementById('generalSettings');
        if (!generalSettings) return;

        const currentContent = generalSettings.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Content will be loaded here -->')) return;

        fetch('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.huntarrUI) window.huntarrUI.originalSettings.general = settings.general;
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateGeneralForm) {
                    SettingsForms.generateGeneralForm(generalSettings, settings.general || {});
                } else {
                    generalSettings.innerHTML = '<p>Error: Settings forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[HuntarrInit] Error loading settings:', error);
                generalSettings.innerHTML = '<p>Error loading settings</p>';
            });
    },

    initializeNotifications: function() {
        console.log('[HuntarrInit] initializeNotifications called');
        const notificationsContainer = document.getElementById('notificationsContainer');
        if (!notificationsContainer) return;
        
        const currentContent = notificationsContainer.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Notifications content will be loaded here -->')) return;

        fetch('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.huntarrUI) {
                    window.huntarrUI.originalSettings.general = settings.general;
                    window.huntarrUI.originalSettings.notifications = settings.general; 
                }
                
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateNotificationsForm) {
                    SettingsForms.generateNotificationsForm(notificationsContainer, settings.general || {});
                } else {
                    notificationsContainer.innerHTML = '<p>Error: Notifications forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[HuntarrInit] Error loading notifications settings:', error);
                notificationsContainer.innerHTML = '<p>Error loading notifications settings</p>';
            });
    },

    initializeBackupRestore: function() {
        console.log('[HuntarrInit] initializeBackupRestore called');
        if (typeof BackupRestore !== 'undefined') {
            BackupRestore.initialize();
        }
    },

    initializeProwlarr: function() {
        console.log('[HuntarrInit] initializeProwlarr called');
        const prowlarrContainer = document.getElementById('prowlarrContainer');
        if (!prowlarrContainer) return;
        
        const currentContent = prowlarrContainer.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Prowlarr content will be loaded here -->')) return;

        fetch('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.huntarrUI) window.huntarrUI.originalSettings.prowlarr = settings.prowlarr;
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateProwlarrForm) {
                    SettingsForms.generateProwlarrForm(prowlarrContainer, settings.prowlarr || {});
                } else {
                    prowlarrContainer.innerHTML = '<p>Error: Prowlarr forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[HuntarrInit] Error loading prowlarr settings:', error);
                prowlarrContainer.innerHTML = '<p>Error loading prowlarr settings</p>';
            });
    },

    initializeUser: function() {
        console.log('[HuntarrInit] initializeUser called');
        if (typeof UserModule !== 'undefined') {
            if (!window.userModule) {
                window.userModule = new UserModule();
            }
        }
    },

    initializeSwaparr: function() {
        console.log('[HuntarrInit] initializeSwaparr called');
        const swaparrContainer = document.getElementById('swaparrContainer');
        if (!swaparrContainer) return;
        
        const currentContent = swaparrContainer.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Swaparr settings content will be shown here -->')) return;

        fetch('./api/swaparr/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.huntarrUI) window.huntarrUI.originalSettings.swaparr = settings;
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateSwaparrForm) {
                    SettingsForms.generateSwaparrForm(swaparrContainer, settings || {});
                    if (window.huntarrUI && window.huntarrUI.loadSwaparrApps) window.huntarrUI.loadSwaparrApps();
                } else {
                    swaparrContainer.innerHTML = '<p>Error: Swaparr forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[HuntarrInit] Error loading Swaparr settings:', error);
                swaparrContainer.innerHTML = '<p>Error loading Swaparr settings</p>';
            });
    }
};
