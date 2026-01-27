/**
 * Theme Module
 * Handles dark mode, logo persistence, and low usage mode
 */

window.HuntarrTheme = {
    logoSrc: null,

    setupLogoHandling: function() {
        const logoImg = document.querySelector('.sidebar .logo');
        if (logoImg) {
            this.logoSrc = logoImg.src;
            if (!logoImg.complete) {
                logoImg.onload = () => {
                    this.logoSrc = logoImg.src;
                };
            }
        }
        
        window.addEventListener('beforeunload', () => {
            if (this.logoSrc) {
                sessionStorage.setItem('huntarr-logo-src', this.logoSrc);
            }
        });
    },

    checkLowUsageMode: function() {
        return HuntarrUtils.fetchWithTimeout('./api/settings/general', { method: 'GET' })
            .then(response => response.json())
            .then(config => {
                const enabled = config?.low_usage_mode === true;
                this.applyLowUsageMode(enabled);
                return config;
            })
            .catch(error => {
                console.error('[HuntarrTheme] Error checking Low Usage Mode:', error);
                this.applyLowUsageMode(false);
                throw error;
            });
    },

    applyLowUsageMode: function(enabled) {
        console.log(`[HuntarrTheme] Setting Low Usage Mode: ${enabled ? 'Enabled' : 'Disabled'}`);
        const wasEnabled = document.body.classList.contains('low-usage-mode');
        
        if (enabled) document.body.classList.add('low-usage-mode');
        else document.body.classList.remove('low-usage-mode');
        
        if (wasEnabled !== enabled && window.mediaStats && window.HuntarrStats) {
            window.HuntarrStats.updateStatsDisplay(window.mediaStats);
        }
    },

    initDarkMode: function() {
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            const prefersDarkMode = localStorage.getItem('huntarr-dark-mode') === 'true';
            darkModeToggle.checked = prefersDarkMode;
            if (prefersDarkMode) document.body.classList.add('dark-theme');
            
            darkModeToggle.addEventListener('change', function() {
                const isDarkMode = this.checked;
                document.body.classList.toggle('dark-theme', isDarkMode);
                localStorage.setItem('huntarr-dark-mode', isDarkMode);
            });
        }
    }
};
