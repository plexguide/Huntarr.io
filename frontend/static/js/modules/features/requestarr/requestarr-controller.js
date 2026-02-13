/**
 * Requestarr Controller - Main entry point and global interface
 */
// RequestarrDiscover from requestarr-core.js (concatenated)
// Initialize the Requestarr Discover system
document.addEventListener('DOMContentLoaded', () => {
    window.RequestarrDiscover = new RequestarrDiscover();
    console.log('[RequestarrController] Discover modules loaded successfully');
});

/**
 * Global HuntarrRequestarr interface for the main app (app.js)
 * This provides a bridge between the core orchestrator and the modular Requestarr system.
 */
window.HuntarrRequestarr = {
    /**
     * Wait for RequestarrDiscover to be initialized before executing a callback
     */
    runWhenRequestarrReady: function(actionName, callback) {
        if (window.RequestarrDiscover) {
            callback();
            return;
        }

        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (window.RequestarrDiscover) {
                clearInterval(checkInterval);
                callback();
                return;
            }

            if (Date.now() - startTime > 2000) {
                clearInterval(checkInterval);
                console.warn(`[HuntarrRequestarr] RequestarrDiscover not ready for ${actionName} after 2s`);
            }
        }, 50);
    },

    /**
     * Show the Requestarr sidebar and hide others
     */
    showRequestarrSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (appsSidebar) appsSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'block';
        
        this.updateRequestarrSidebarActive();
    },

    /**
     * Show a specific Requestarr view (home, discover, etc.)
     */
    showRequestarrView: function(view) {
        const homeView = document.getElementById('requestarr-home-view');
        if (homeView) homeView.style.display = view === 'home' ? 'block' : 'none';
        this.updateRequestarrNavigation(view);
    },

    /**
     * Update the active state of items in the Requestarr sidebar
     */
    updateRequestarrSidebarActive: function() {
        if (!window.huntarrUI) return;
        const currentSection = window.huntarrUI.currentSection;
        const requestarrSidebarItems = document.querySelectorAll('#requestarr-sidebar .nav-item');
        
        requestarrSidebarItems.forEach(item => {
            item.classList.remove('active');
            const link = item.querySelector('a');
            if (link && link.getAttribute('href') === `#${currentSection}`) {
                item.classList.add('active');
            }
        });
    },

    /**
     * Delegate view switching to the RequestarrDiscover instance
     */
    updateRequestarrNavigation: function(view) {
        if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
            window.RequestarrDiscover.switchView(view);
        }
    },

    /**
     * Set up click handlers for Requestarr sidebar items
     */
    setupRequestarrNavigation: function() {
        const requestarrNavItems = document.querySelectorAll('#requestarr-sidebar .nav-item a');
        requestarrNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const href = item.getAttribute('href');
                if (href) window.location.hash = href;
            });
        });
    }
};
