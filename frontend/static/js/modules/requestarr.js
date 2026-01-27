/**
 * Requestarr Module
 * Handles Requestarr-specific functionality and navigation
 */

window.HuntarrRequestarr = {
    runWhenRequestarrReady: function(actionName, callback) {
        if (typeof window.RequestarrDiscover !== 'undefined') {
            callback();
            return;
        }

        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (typeof window.RequestarrDiscover !== 'undefined') {
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

    showRequestarrSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'block';
        
        this.updateRequestarrSidebarActive();
    },

    showRequestarrView: function(view) {
        const homeView = document.getElementById('requestarr-home-view');
        if (homeView) homeView.style.display = view === 'home' ? 'block' : 'none';
        this.updateRequestarrNavigation(view);
    },

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

    updateRequestarrNavigation: function(view) {
        if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
            window.RequestarrDiscover.switchView(view);
        }
    },

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
