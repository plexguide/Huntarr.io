/**
 * DOM Module
 * Handles element caching and low-level DOM utilities
 */

window.HuntarrDOM = {
    cacheElements: function(ui) {
        if (!ui || !ui.elements) return;
        
        const elements = ui.elements;
        
        // Navigation
        elements.navItems = document.querySelectorAll('.nav-item');
        elements.homeNav = document.getElementById('homeNav');
        elements.logsNav = document.getElementById('logsNav');
        elements.huntManagerNav = document.getElementById('huntManagerNav');
        elements.settingsNav = document.getElementById('settingsNav');
        elements.userNav = document.getElementById('userNav');
        
        // Sections
        elements.sections = document.querySelectorAll('.content-section');
        elements.homeSection = document.getElementById('homeSection');
        elements.logsSection = document.getElementById('logsSection');
        elements.huntManagerSection = document.getElementById('huntManagerSection');
        elements.settingsSection = document.getElementById('settingsSection');
        elements.settingsLogsSection = document.getElementById('settingsLogsSection');
        elements.schedulingSection = document.getElementById('schedulingSection');
        
        // History dropdown elements
        elements.historyOptions = document.querySelectorAll('.history-option');
        elements.currentHistoryApp = document.getElementById('current-history-app');
        elements.historyDropdownBtn = document.querySelector('.history-dropdown-btn');
        elements.historyDropdownContent = document.querySelector('.history-dropdown-content');
        elements.historyPlaceholderText = document.getElementById('history-placeholder-text');
        
        // Settings dropdown elements
        elements.settingsOptions = document.querySelectorAll('.settings-option');
        elements.currentSettingsApp = document.getElementById('current-settings-app');
        elements.settingsDropdownBtn = document.querySelector('.settings-dropdown-btn');
        elements.settingsDropdownContent = document.querySelector('.settings-dropdown-content');
        
        elements.appSettingsPanels = document.querySelectorAll('.app-settings-panel');
        
        // Status elements
        elements.sonarrHomeStatus = document.getElementById('sonarrHomeStatus');
        elements.radarrHomeStatus = document.getElementById('radarrHomeStatus');
        elements.lidarrHomeStatus = document.getElementById('lidarrHomeStatus');
        elements.readarrHomeStatus = document.getElementById('readarrHomeStatus');
        elements.whisparrHomeStatus = document.getElementById('whisparrHomeStatus');
        elements.erosHomeStatus = document.getElementById('erosHomeStatus');
        
        // Actions
        elements.startHuntButton = document.getElementById('startHuntButton');
        elements.stopHuntButton = document.getElementById('stopHuntButton');
        
        // Logout
        elements.logoutLink = document.getElementById('logoutLink');
    },

    showDashboard: function() {
        // Make the dashboard grid visible after initialization to prevent FOUC
        const dashboardGrid = document.querySelector('.dashboard-grid');
        if (dashboardGrid) {
            dashboardGrid.style.opacity = '1';
            console.log('[HuntarrDOM] Dashboard made visible after initialization');
        } else {
            console.warn('[HuntarrDOM] Dashboard grid not found');
        }
    }
};
