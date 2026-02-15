/**
 * Requestarr Controller - Main entry point and global interface
 */
// RequestarrDiscover from requestarr-core.js (concatenated)
// Initialize the Requestarr Discover system (handle defer + DOMContentLoaded race)
function initRequestarrDiscover() {
    window.RequestarrDiscover = new RequestarrDiscover();
    console.log('[RequestarrController] Discover modules loaded successfully');
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRequestarrDiscover);
} else {
    initRequestarrDiscover();
}

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
     * Expand the Requests group in the unified sidebar
     */
    showRequestarrSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-requests');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
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
     * Update the active state of items in the Requests group
     */
    updateRequestarrSidebarActive: function() {
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
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
     * Set up click handlers for Requestarr nav items (unified sidebar, hash links handle it)
     */
    setupRequestarrNavigation: function() {
        // Navigation handled by hash links in the unified sidebar
    }
};
