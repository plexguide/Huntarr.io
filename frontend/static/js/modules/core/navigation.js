/**
 * Navigation Module
 * Handles section switching, hash navigation, and sidebar management
 */

window.HuntarrNavigation = {
    // Handle navigation clicks
    handleNavigation: function(e) {
        e.preventDefault();
        
        const target = e.currentTarget;
        const href = target.getAttribute('href');
        const isInternalLink = href && href.startsWith('#');
        
        // Check for unsaved changes before navigating
        if (window.huntarrUI && typeof window.huntarrUI.suppressUnsavedChangesCheck === 'boolean') {
            if (window.huntarrUI.suppressUnsavedChangesCheck) {
                console.log('[Navigation] Suppression flag active, allowing navigation without check');
                window.huntarrUI.suppressUnsavedChangesCheck = false;
            }
        }
        
        // Add special handling for apps section - clear global app module flags
        if (window.huntarrUI && window.huntarrUI.currentSection === 'apps' && href && !href.includes('apps')) {
            // Reset the app module flags when navigating away
            if (window._appsModuleLoaded) {
                window._appsSuppressChangeDetection = true;
                if (window.appsModule && typeof window.appsModule.settingsChanged !== 'undefined') {
                    window.appsModule.settingsChanged = false;
                }
                // Schedule ending suppression to avoid any edge case issues
                setTimeout(() => {
                    window._appsSuppressChangeDetection = false;
                }, 1000);
            }
        }

        // Proceed with navigation
        if (isInternalLink) {
            window.location.hash = href; // Change hash to trigger handleHashNavigation
        } else {
            // If it's an external link (like /user), just navigate normally
            window.location.href = href;
        }
    },
    
    handleHashNavigation: function(hash) {
        let section = (hash || '').replace(/^#+/, '').trim();
        if (section.indexOf('%23') >= 0) section = section.split('%23').pop() || section;
        if (section.indexOf('./') === 0) section = section.replace(/^\.?\/*/, '');
        if (!section) section = 'home';
        // Requestarr detail pages (e.g. requestarr-movie/12345) can't be restored on refresh.
        // Redirect to the parent Requestarr view so the user stays in Requestarr.
        if (/^requestarr-movie\//.test(section)) {
            section = 'requestarr-discover';
            if (window.location.hash !== '#requestarr-discover') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#requestarr-discover');
            }
        }
        // Legacy Movie Hunt home → Media Hunt Collection
        if (section === 'movie-hunt-home') {
            section = 'media-hunt-collection';
            if (window.location.hash !== '#media-hunt-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-collection');
            }
        }
        // TV/Movie Collection → unified Media Hunt Collection
        if (section === 'tv-hunt-collection' || section === 'movie-hunt-collection') {
            if (window.huntarrUI) window.huntarrUI._pendingMediaHuntSidebar = 'movie';
            section = 'media-hunt-collection';
            if (window.location.hash !== '#media-hunt-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-collection');
            }
        }
        // Legacy TV Hunt home → Media Hunt Collection
        if (section === 'tv-hunt-home') {
            section = 'media-hunt-collection';
            if (window.location.hash !== '#media-hunt-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-collection');
            }
        }
        if (section === 'activity') {
            section = 'activity-queue';
            if (window.location.hash !== '#activity-queue') window.location.hash = 'activity-queue';
        }
        // NZB Hunt Settings → go directly to Folders
        if (section === 'nzb-hunt-settings') {
            section = 'nzb-hunt-settings-folders';
            if (window.location.hash !== '#nzb-hunt-settings-folders') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-settings-folders');
            }
        }
        // NZB Hunt Processing → merged into Advanced
        if (section === 'nzb-hunt-settings-processing') {
            section = 'nzb-hunt-settings-advanced';
            if (window.location.hash !== '#nzb-hunt-settings-advanced') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-settings-advanced');
            }
        }
        // Instances merged into Settings: old bookmark redirects to Media Hunt Settings
        if (section === 'settings-instance-management') {
            section = 'media-hunt-settings';
            if (window.location.hash !== '#media-hunt-settings') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-settings');
            }
        }
        if (window.huntarrUI) {
            window.huntarrUI.switchSection(section);
        }
    },

    // switchSection is handled by huntarrUI.switchSection() in app.js.
    // This module only provides handleHashNavigation() which delegates to it.
    
    // System tab management
    switchSystemTab: function(tab) {
        // Update tab buttons
        document.querySelectorAll('#systemSection .system-tab').forEach(function(t) {
            t.classList.toggle('active', t.getAttribute('data-system-tab') === tab);
        });
        // Update tab panels
        document.querySelectorAll('#systemSection .system-tab-panel').forEach(function(p) {
            var isActive = p.getAttribute('data-system-panel') === tab;
            p.style.display = isActive ? 'block' : 'none';
            p.classList.toggle('active', isActive);
        });
    },

    setupSystemTabs: function() {
        var self = this;
        document.querySelectorAll('#systemSection .system-tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                var t = tab.getAttribute('data-system-tab');
                if (t) {
                    // Update the hash to reflect the tab
                    window.location.hash = t === 'hunt-manager' ? 'hunt-manager' : t;
                }
            });
        });
    },

    // Sidebar management functions
    showMainSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'none';
        if (mainSidebar) mainSidebar.style.display = 'block';
        if (appsSidebar) appsSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'none';

        // When on System (Hunt Manager, Logs, About), hide Apps, Requestarr, Settings in main sidebar on mobile only; desktop keeps all visible
        // When on Settings (Main, Scheduling, etc.), hide Apps, Requestarr, System in main sidebar
        var section = window.huntarrUI && window.huntarrUI.currentSection;
        var onSystem = section === 'system' || section === 'hunt-manager' || section === 'logs' || section === 'about';
        var onSettings = ['settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user'].indexOf(section) !== -1;
        var isDesktop = window.innerWidth > 768;
        var settingsNav = document.getElementById('settingsNav');
        var requestarrNav = document.getElementById('requestarrNav');
        var appsNav = document.getElementById('appsNav');
        var systemNav = document.getElementById('systemNav');
        var settingsSubGroup = document.getElementById('settings-sub');
        var systemSubGroup = document.getElementById('system-sub');
        if (onSystem && isDesktop) {
            if (settingsNav) settingsNav.style.display = '';
            if (settingsSubGroup) { settingsSubGroup.style.display = 'none'; settingsSubGroup.classList.remove('expanded'); }
            if (requestarrNav) requestarrNav.style.display = '';
            if (appsNav) appsNav.style.display = '';
            if (systemNav) systemNav.style.display = '';
            if (systemSubGroup) { systemSubGroup.style.display = 'block'; systemSubGroup.classList.add('expanded'); }
        } else if (onSettings && isDesktop) {
            if (settingsNav) settingsNav.style.display = '';
            if (settingsSubGroup) { settingsSubGroup.style.display = 'block'; settingsSubGroup.classList.add('expanded'); }
            if (requestarrNav) requestarrNav.style.display = '';
            if (appsNav) appsNav.style.display = '';
            if (systemNav) systemNav.style.display = '';
            if (systemSubGroup) { systemSubGroup.style.display = 'none'; systemSubGroup.classList.remove('expanded'); }
        } else {
            if (settingsNav) settingsNav.style.display = onSystem ? 'none' : '';
            if (settingsSubGroup) { settingsSubGroup.style.display = onSystem ? 'none' : (onSettings ? 'block' : 'none'); settingsSubGroup.classList.toggle('expanded', onSettings); }
            if (requestarrNav) requestarrNav.style.display = (onSystem || onSettings) ? 'none' : '';
            if (appsNav) appsNav.style.display = (onSystem || onSettings) ? 'none' : '';
            if (systemNav) systemNav.style.display = onSettings ? 'none' : '';
            if (systemSubGroup) { systemSubGroup.style.display = onSettings ? 'none' : (onSystem ? 'block' : 'none'); systemSubGroup.classList.toggle('expanded', onSystem); }
        }
        if (window.huntarrUI && typeof window.huntarrUI._updateMainSidebarBetaVisibility === 'function') {
            window.huntarrUI._updateMainSidebarBetaVisibility();
        }
    },

    showAppsSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'none';
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (appsSidebar) appsSidebar.style.display = 'block';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'none';
        
        // Update active state
        this.updateAppsSidebarActive();
    },

    showSettingsSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'none';
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (appsSidebar) appsSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'block';
        if (requestarrSidebar) requestarrSidebar.style.display = 'none';
        
        // Update active state
        this.updateSettingsSidebarActive();
    },

    showRequestarrSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (appsSidebar) appsSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'block';
        
        this.updateRequestarrSidebarActive();
    },

    showMovieHuntSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (appsSidebar) appsSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'none';
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'flex';
        
        this.updateMovieHuntSidebarActive();
    },

    showTVHuntSidebar: function() {
        // TV Hunt menu removed; use Media Hunt (movie-hunt) sidebar for all media-hunt sections
        this.showMovieHuntSidebar();
    },

    updateMovieHuntSidebarActive: function() {
        if (!window.huntarrUI) return;
        const currentSection = window.huntarrUI.currentSection;
        let sectionForNav = currentSection;
        if (currentSection === 'instance-editor' && window.SettingsForms && window.SettingsForms._currentEditing) {
            const appType = window.SettingsForms._currentEditing.appType;
            if (appType === 'indexer') sectionForNav = 'settings-indexers';
            else if (appType === 'client') sectionForNav = 'settings-clients';
        }
        const collectionSections = ['movie-hunt-home', 'movie-hunt-collection', 'media-hunt-collection', 'settings-import-media', 'movie-hunt-calendar'];
        const activitySections = ['activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-movie-hunt'];
        const settingsSections = ['movie-hunt-settings', 'media-hunt-settings', 'settings-instance-management', 'settings-movie-management', 'settings-profiles', 'settings-sizes', 'profile-editor', 'settings-custom-formats', 'settings-indexers', 'settings-clients', 'settings-import-lists', 'settings-root-folders', 'instance-editor'];
        const onCollection = collectionSections.indexOf(currentSection) !== -1;
        const onActivity = activitySections.indexOf(sectionForNav) !== -1;
        const onSettings = settingsSections.indexOf(currentSection) !== -1;

        const colSub = document.getElementById('movie-hunt-collection-sub');
        const actSub = document.getElementById('movie-hunt-activity-sub');
        const setSub = document.getElementById('movie-hunt-settings-sub');
        if (colSub) colSub.classList.toggle('expanded', onCollection);
        if (actSub) actSub.classList.toggle('expanded', onActivity);
        if (setSub) setSub.classList.toggle('expanded', onSettings);

        const items = document.querySelectorAll('#movie-hunt-sidebar .nav-item');
        const isActivitySub = activitySections.indexOf(sectionForNav) !== -1;
        items.forEach(item => {
            item.classList.remove('active');
            if (isActivitySub && item.id === 'movieHuntActivityNav') return;
            const href = item.getAttribute && item.getAttribute('href') || (item.querySelector('a') && item.querySelector('a').getAttribute('href'));
            if (href && (href === '#' + sectionForNav || href.endsWith('#' + sectionForNav))) {
                item.classList.add('active');
            }
        });
    },

    updateTVHuntSidebarActive: function() {
        // TV Hunt sidebar removed; no-op
    },

    updateAppsSidebarActive: function() {
        if (!window.huntarrUI) return;
        
        const currentSection = window.huntarrUI.currentSection;
        const appsSidebarItems = document.querySelectorAll('#apps-sidebar .nav-item');
        
        appsSidebarItems.forEach(item => {
            item.classList.remove('active');
            const href = (item.getAttribute && item.getAttribute('href')) || '';
            if (href === `#${currentSection}` || (href && href.endsWith('#' + currentSection))) {
                item.classList.add('active');
            }
        });
    },

    updateSettingsSidebarActive: function() {
        if (!window.huntarrUI) return;
        
        const currentSection = window.huntarrUI.currentSection;
        const settingsSidebarItems = document.querySelectorAll('#settings-sidebar .nav-item');
        
        settingsSidebarItems.forEach(item => {
            item.classList.remove('active');
            const href = item.getAttribute && item.getAttribute('href') || (item.querySelector('a') && item.querySelector('a').getAttribute('href'));
            if (href && (href === '#' + currentSection || href.endsWith('#' + currentSection))) {
                item.classList.add('active');
            }
        });
    },

    updateRequestarrSidebarActive: function() {
        if (!window.huntarrUI) return;
        
        const currentSection = window.huntarrUI.currentSection;
        const requestarrSidebarItems = document.querySelectorAll('#requestarr-sidebar .nav-item');
        
        requestarrSidebarItems.forEach(item => {
            item.classList.remove('active');
            const link = item.querySelector('a');
            if (link) {
                const href = link.getAttribute('href');
                if (href === `#${currentSection}`) {
                    item.classList.add('active');
                }
            }
        });
    },

    setupAppsNavigation: function() {
        console.log('[Navigation] Setting up apps navigation');
        
        const appsNavItems = document.querySelectorAll('#apps-sidebar .nav-item a');
        appsNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const href = item.getAttribute('href');
                if (href) {
                    window.location.hash = href;
                }
            });
        });
    },

    setupSettingsNavigation: function() {
        console.log('[Navigation] Setting up settings navigation');
        
        const settingsNavItems = document.querySelectorAll('#settings-sidebar .nav-item a');
        settingsNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const href = item.getAttribute('href');
                if (href) {
                    window.location.hash = href;
                }
            });
        });
    },

    // setupRequestarrNavigation: handled by HuntarrRequestarr.setupRequestarrNavigation() in requestarr-controller.js

    setupMovieHuntNavigation: function() {
        const movieHuntNavItems = document.querySelectorAll('#movie-hunt-sidebar .nav-item a');
        movieHuntNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const href = item.getAttribute('href') || '';
                const hashIdx = href.indexOf('#');
                const fragment = hashIdx >= 0 ? href.substring(hashIdx + 1) : href.replace(/^\.?\/*/, '');
                if (fragment) window.location.hash = fragment;
            });
        });
    },

    setupTVHuntNavigation: function() {
        // TV Hunt sidebar removed; no-op
    },

    setupNzbHuntNavigation: function() {
        const nzbHuntNavItems = document.querySelectorAll('#nzb-hunt-sidebar .nav-item');
        nzbHuntNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const link = item.tagName === 'A' ? item : item.querySelector('a');
                if (!link) return;
                const href = link.getAttribute('href') || '';
                const hashIdx = href.indexOf('#');
                const fragment = hashIdx >= 0 ? href.substring(hashIdx + 1) : href.replace(/^\.?\/*/, '');
                if (fragment) window.location.hash = fragment;
            });
        });
    },

    updateRequestarrNavigation: function(view) {
        if (!window.RequestarrDiscover || !window.RequestarrDiscover.switchView) {
            console.warn('[Navigation] RequestarrDiscover not available');
            return;
        }
        window.RequestarrDiscover.switchView(view);
    }
};
