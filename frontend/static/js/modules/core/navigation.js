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
        // Requestarr TV detail (#requestarr-tv/ID) - keep hash so RequestarrTVDetail can restore on refresh
        if (/^requestarr-tv\/(\d+)$/.test(section)) {
            section = 'requestarr-tv';
        }
        // Legacy Movie Hunt home → Media Hunt Collection
        if (section === 'movie-hunt-home') {
            section = 'media-hunt-collection';
            if (window.location.hash !== '#media-hunt-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-collection');
            }
        }
        // Media Hunt Collection TV detail: #media-hunt-collection/tv/12345 — redirect to Requestarr TV detail (which has full UI)
        if (/^media-hunt-collection\/tv\/(\d+)$/.test(section)) {
            var tmdbMatch = section.match(/media-hunt-collection\/tv\/(\d+)/);
            if (tmdbMatch) {
                section = 'requestarr-tv/' + tmdbMatch[1];
                if (window.location.hash !== '#requestarr-tv/' + tmdbMatch[1]) {
                    window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#requestarr-tv/' + tmdbMatch[1]);
                }
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
        // Media Hunt movie detail direct link: #movie/<tmdb_id> — switch to collection, keep hash for MovieHuntDetail.checkUrlForMovieDetail()
        if (/^movie\/(\d+)$/.test(section)) {
            if (window.huntarrUI) window.huntarrUI._pendingMediaHuntSidebar = 'movie';
            section = 'media-hunt-collection';
            // Do NOT replace the hash; leave #movie/<id> so MovieHuntDetail opens the movie
        }
        if (section === 'activity') {
            section = 'activity-queue';
            if (window.location.hash !== '#activity-queue') window.location.hash = 'activity-queue';
        }
        // Legacy: logs-movie-hunt → logs-media-hunt
        if (section === 'logs-movie-hunt') {
            section = 'logs-media-hunt';
            if (window.location.hash !== '#logs-media-hunt') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#logs-media-hunt');
            }
        }
        // NZB Hunt: canonical hashes are nzb-hunt-folders, nzb-hunt-servers, nzb-hunt-advanced
        // Legacy nzb-hunt-settings* → redirect to new hashes
        if (section === 'nzb-hunt-settings' || section === 'nzb-hunt-settings-folders') {
            section = 'nzb-hunt-folders';
            if (window.location.hash !== '#nzb-hunt-folders') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-folders');
            }
        }
        if (section === 'nzb-hunt-settings-servers') {
            section = 'nzb-hunt-servers';
            if (window.location.hash !== '#nzb-hunt-servers') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-servers');
            }
        }
        if (section === 'nzb-hunt-settings-processing' || section === 'nzb-hunt-settings-advanced') {
            section = 'nzb-hunt-advanced';
            if (window.location.hash !== '#nzb-hunt-advanced') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-advanced');
            }
        }
        // Instances moved to Collection: settings-instance-management redirects to media-hunt-instances
        if (section === 'settings-instance-management') {
            section = 'media-hunt-instances';
            if (window.location.hash !== '#media-hunt-instances') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-instances');
            }
        }
        // Legacy media-hunt-settings: go to Media Management so Settings sub-menu expands and shows sub-items
        if (section === 'media-hunt-settings') {
            section = 'settings-media-management';
            if (window.location.hash !== '#settings-media-management') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#settings-media-management');
            }
        }
        // Legacy: Movie Management → Media Management
        if (section === 'settings-movie-management') {
            section = 'settings-media-management';
            if (window.location.hash !== '#settings-media-management') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#settings-media-management');
            }
        }
        // Legacy: TV Hunt settings → unified Media Hunt settings (sidebar was removed)
        // NOTE: tv-hunt-activity-* are NOT redirected - they show TV Hunt Activity (Queue/History/Blocklist)
        var tvHuntToSettings = {
            'tv-hunt-settings-custom-formats': 'settings-custom-formats',
            'tv-hunt-settings-profiles': 'settings-profiles',
            'tv-hunt-settings-indexers': 'indexer-hunt',
            'tv-hunt-settings-clients': 'settings-clients',
            'tv-hunt-settings-root-folders': 'settings-root-folders',
            'settings-import-media-tv': 'settings-import-media',
            'tv-hunt-settings-sizes': 'settings-sizes',
            'tv-hunt-settings-tv-management': 'settings-media-management',
            'tv-hunt-settings-import-lists': 'settings-import-lists',
        };
        if (tvHuntToSettings[section]) {
            var target = tvHuntToSettings[section];
            section = target;
            if (window.location.hash !== '#' + target) {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#' + target);
            }
        }
        // App instance editor URLs: #radarr-settings, #radarr-settings/0, #sonarr-settings, etc.
        var appSettingsMatch = section.match(/^(sonarr|radarr|lidarr|readarr|whisparr|eros|prowlarr)-settings(?:\/(\d+))?$/);
        if (appSettingsMatch) {
            var appType = appSettingsMatch[1];
            var idx = appSettingsMatch[2] != null ? parseInt(appSettingsMatch[2], 10) : null;
            if (window.SettingsForms && typeof window.SettingsForms.navigateToInstanceEditor === 'function') {
                var hasSettings = window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings[appType];
                if (hasSettings) {
                    window.SettingsForms.navigateToInstanceEditor(appType, idx);
                    return;
                }
            }
            section = appType;
            window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#' + appType);
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

    // ─── Sidebar management ───────────────────────────────────
    // With the unified sidebar there is only one #sidebar element.
    // The show*Sidebar() API is preserved so app.js callers don't change.
    // Each function now expands the relevant accordion group instead
    // of toggling display on separate sidebar divs.

    showMainSidebar: function() {
        // Home page — collapse all groups
        if (typeof expandSidebarGroup === 'function') {
            // Let setActiveNavItem handle it via hashchange
        }
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showAppsSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-apps');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showSettingsSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-settings');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showRequestarrSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-requests');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showMovieHuntSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-media-hunt');
        this.updateMovieHuntSidebarActive();
    },

    showTVHuntSidebar: function() {
        this.showMovieHuntSidebar();
    },

    updateMovieHuntSidebarActive: function() {
        if (!window.huntarrUI) return;
        const currentSection = window.huntarrUI.currentSection;
        let sectionForNav = currentSection;
        if (currentSection === 'instance-editor' && window.SettingsForms && window.SettingsForms._currentEditing) {
            const appType = window.SettingsForms._currentEditing.appType;
            if (appType === 'indexer') sectionForNav = 'indexer-hunt';
            else if (appType === 'client') sectionForNav = 'settings-clients';
        }
        const collectionSections = ['movie-hunt-home', 'movie-hunt-collection', 'media-hunt-collection', 'settings-import-media', 'movie-hunt-calendar'];
        const activitySections = ['activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-media-hunt', 'logs-tv-hunt', 'tv-hunt-activity-queue', 'tv-hunt-activity-history', 'tv-hunt-activity-blocklist'];
        const settingsSections = ['movie-hunt-settings', 'media-hunt-settings', 'settings-instance-management', 'settings-media-management', 'settings-profiles', 'settings-sizes', 'profile-editor', 'settings-custom-formats', 'settings-import-lists', 'settings-root-folders', 'instance-editor'];
        const indexMasterSections = ['indexer-hunt', 'indexer-hunt-stats', 'indexer-hunt-history'];
        const onCollection = collectionSections.indexOf(currentSection) !== -1;
        const onActivity = activitySections.indexOf(sectionForNav) !== -1;
        const onSettings = settingsSections.indexOf(currentSection) !== -1;
        const onIndexMaster = indexMasterSections.indexOf(sectionForNav) !== -1;

        const colSub = document.getElementById('movie-hunt-collection-sub');
        const actSub = document.getElementById('movie-hunt-activity-sub');
        const setSub = document.getElementById('movie-hunt-settings-sub');
        const idxMasterSub = document.getElementById('index-master-sub');
        if (colSub) colSub.classList.toggle('expanded', onCollection);
        if (actSub) actSub.classList.toggle('expanded', onActivity);
        if (setSub) setSub.classList.toggle('expanded', onSettings);
        if (idxMasterSub) idxMasterSub.classList.toggle('expanded', onIndexMaster);

        // Highlight the active item within #sidebar (unified)
        const items = document.querySelectorAll('#sidebar-group-media-hunt .nav-item');
        const isActivitySub = activitySections.indexOf(sectionForNav) !== -1;
        var tvToMovieNav = { 'tv-hunt-activity-queue': 'activity-queue', 'tv-hunt-activity-history': 'activity-history', 'tv-hunt-activity-blocklist': 'activity-blocklist', 'logs-tv-hunt': 'logs-media-hunt' };
        var navTarget = tvToMovieNav[sectionForNav] || sectionForNav;
        items.forEach(item => {
            item.classList.remove('active');
            if (isActivitySub && item.id === 'movieHuntActivityNav') return;
            const href = item.getAttribute && item.getAttribute('href') || (item.querySelector('a') && item.querySelector('a').getAttribute('href'));
            var targetHash = (href || '').replace(/^[^#]*#/, '');
            if (targetHash && (targetHash === navTarget || targetHash === sectionForNav)) {
                item.classList.add('active');
            }
        });
    },

    updateTVHuntSidebarActive: function() {
        // TV Hunt sidebar removed; no-op
    },

    updateAppsSidebarActive: function() {
        // Active state is handled by setActiveNavItem() in the inline script
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    updateSettingsSidebarActive: function() {
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    updateRequestarrSidebarActive: function() {
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    setupAppsNavigation: function() {
        // Navigation is handled by hash links — no extra click listeners needed with unified sidebar
    },

    setupSettingsNavigation: function() {
        // Navigation is handled by hash links
    },

    // setupRequestarrNavigation: handled by HuntarrRequestarr.setupRequestarrNavigation() in requestarr-controller.js

    setupMovieHuntNavigation: function() {
        // Navigation is handled by hash links
    },

    setupTVHuntNavigation: function() {
        // TV Hunt sidebar removed; no-op
    },

    setupNzbHuntNavigation: function() {
        // Navigation is handled by hash links
    },

    updateRequestarrNavigation: function(view) {
        if (!window.RequestarrDiscover || !window.RequestarrDiscover.switchView) {
            console.warn('[Navigation] RequestarrDiscover not available');
            return;
        }
        window.RequestarrDiscover.switchView(view);
    }
};
