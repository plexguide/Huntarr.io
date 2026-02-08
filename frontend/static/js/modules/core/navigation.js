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
        if (section === 'activity') {
            section = 'activity-queue';
            if (window.location.hash !== '#activity-queue') window.location.hash = 'activity-queue';
        }
        if (window.huntarrUI) {
            window.huntarrUI.switchSection(section);
        }
    },

    switchSection: function(section) {
        if (!window.huntarrUI) return;
        const ui = window.huntarrUI;
        console.log(`[HuntarrNavigation] switchSection: ${section}, current: ${ui.currentSection}`);
        
        if (ui.isInitialized && ui.currentSection && ui.currentSection !== section) {
            if (ui.currentSection === 'swaparr' && window.SettingsForms?.checkUnsavedChanges && !window.SettingsForms.checkUnsavedChanges()) return;
            if (ui.currentSection === 'settings' && window.SettingsForms?.checkUnsavedChanges && !window.SettingsForms.checkUnsavedChanges()) return;
            if (ui.currentSection === 'notifications' && window.SettingsForms?.checkUnsavedChanges && !window.SettingsForms.checkUnsavedChanges()) return;
            if (['apps'].includes(ui.currentSection) && window.SettingsForms?.checkUnsavedChanges && !window.SettingsForms.checkUnsavedChanges()) return;
            if (ui.currentSection === 'prowlarr' && window.SettingsForms?.checkUnsavedChanges && !window.SettingsForms.checkUnsavedChanges()) return;
            
            const noRefresh = ['home', 'instance-editor', 'profile-editor', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'swaparr', 'movie-hunt-home', 'movie-hunt-collection', 'activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-movie-hunt', 'movie-hunt-settings', 'settings-instance-management', 'settings-movie-management', 'settings-profiles', 'settings-indexers', 'settings-clients', 'settings-custom-formats', 'settings-root-folders', 'system', 'hunt-manager', 'logs', 'about', 'settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user', 'nzb-hunt-home', 'nzb-hunt-activity', 'nzb-hunt-settings'];
            if (!noRefresh.includes(section) && !noRefresh.includes(ui.currentSection)) {
                localStorage.setItem('huntarr-target-section', section);
                location.reload();
                return;
            }
        }
        
        ui.elements.sections.forEach(s => {
            s.classList.remove('active');
            s.style.display = 'none';
        });
        
        if (section !== 'scheduling' && ui.elements.schedulingSection) ui.elements.schedulingSection.style.display = 'none';
        
        ui.elements.navItems.forEach(item => item.classList.remove('active'));
        
        let newTitle = 'Home';
        const sectionMap = {
            'home': { title: 'Home', nav: ui.elements.homeNav, section: ui.elements.homeSection, sidebar: 'main' },
            'system': { title: 'Hunt Manager', nav: document.getElementById('mainSystemHuntManagerNav'), section: document.getElementById('systemSection'), sidebar: 'main', systemTab: 'hunt-manager' },
            'hunt-manager': { title: 'Hunt Manager', nav: document.getElementById('mainSystemHuntManagerNav'), section: document.getElementById('systemSection'), sidebar: 'main', systemTab: 'hunt-manager' },
            'logs': { title: 'Logs', nav: document.getElementById('mainSystemLogsNav'), section: document.getElementById('systemSection'), sidebar: 'main', systemTab: 'logs' },
            'about': { title: 'About', nav: document.getElementById('mainSystemAboutNav'), section: document.getElementById('systemSection'), sidebar: 'main', systemTab: 'about' },
            'movie-hunt-home': { title: 'Movie Hunt', nav: document.getElementById('movieHuntHomeNav'), section: document.getElementById('movie-hunt-section'), sidebar: 'moviehunt', view: 'movies' },
            'movie-hunt-collection': { title: 'Media Collection', nav: document.getElementById('movieHuntCollectionNav'), section: document.getElementById('movie-hunt-section'), sidebar: 'moviehunt', view: 'collection' },
            'activity-queue': { title: 'Activity – Queue', nav: document.getElementById('movieHuntActivityQueueNav'), section: document.getElementById('activitySection'), sidebar: 'moviehunt', view: 'queue' },
            'activity-history': { title: 'Activity – History', nav: document.getElementById('movieHuntActivityHistoryNav'), section: document.getElementById('activitySection'), sidebar: 'moviehunt', view: 'history' },
            'activity-blocklist': { title: 'Activity – Blocklist', nav: document.getElementById('movieHuntActivityBlocklistNav'), section: document.getElementById('activitySection'), sidebar: 'moviehunt', view: 'blocklist' },
            'activity-logs': { title: 'Activity – Logs', nav: document.getElementById('movieHuntActivityLogsNav'), section: document.getElementById('activitySection'), sidebar: 'moviehunt', view: 'logs' },
            'logs-movie-hunt': { title: 'Logs', nav: document.getElementById('movieHuntActivityLogsNav'), section: document.getElementById('logsSection'), sidebar: 'moviehunt' },
            'movie-hunt-settings': { title: 'Movie Hunt Settings', nav: document.getElementById('movieHuntSettingsNav'), section: document.getElementById('movie-hunt-settings-default-section'), sidebar: 'moviehunt', view: 'settings' },
            'requestarr': { title: 'Discover', nav: document.getElementById('requestarrNav'), section: document.getElementById('requestarr-section'), sidebar: 'requestarr', view: 'discover' },
            'requestarr-discover': { title: 'Discover', nav: document.getElementById('requestarrDiscoverNav'), section: document.getElementById('requestarr-section'), sidebar: 'requestarr', view: 'discover' },
            'requestarr-movies': { title: 'Movies', nav: document.getElementById('requestarrMoviesNav'), section: document.getElementById('requestarr-section'), sidebar: 'requestarr', view: 'movies' },
            'requestarr-tv': { title: 'TV Shows', nav: document.getElementById('requestarrTVNav'), section: document.getElementById('requestarr-section'), sidebar: 'requestarr', view: 'tv' },
            'requestarr-hidden': { title: 'Hidden Media', nav: document.getElementById('requestarrHiddenNav'), section: document.getElementById('requestarr-section'), sidebar: 'requestarr', view: 'hidden' },
            'requestarr-settings': { title: 'Settings', nav: document.getElementById('requestarrSettingsNav'), section: document.getElementById('requestarr-section'), sidebar: 'requestarr', view: 'settings' },
            'sonarr': { title: 'Sonarr', nav: document.getElementById('appsSonarrNav'), section: document.getElementById('sonarrSection'), sidebar: 'apps', app: 'sonarr' },
            'radarr': { title: 'Radarr', nav: document.getElementById('appsRadarrNav'), section: document.getElementById('radarrSection'), sidebar: 'apps', app: 'radarr' },
            'lidarr': { title: 'Lidarr', nav: document.getElementById('appsLidarrNav'), section: document.getElementById('lidarrSection'), sidebar: 'apps', app: 'lidarr' },
            'readarr': { title: 'Readarr', nav: document.getElementById('appsReadarrNav'), section: document.getElementById('readarrSection'), sidebar: 'apps', app: 'readarr' },
            'whisparr': { title: 'Whisparr V2', nav: document.getElementById('appsWhisparrNav'), section: document.getElementById('whisparrSection'), sidebar: 'apps', app: 'whisparr' },
            'eros': { title: 'Whisparr V3', nav: document.getElementById('appsErosNav'), section: document.getElementById('erosSection'), sidebar: 'apps', app: 'eros' },
            'swaparr': { title: 'Swaparr', nav: document.getElementById('appsSwaparrNav'), section: document.getElementById('swaparrSection'), sidebar: 'apps', init: 'initializeSwaparr' },
            'settings': { title: 'Settings', nav: document.getElementById('mainSettingsMainNav'), section: document.getElementById('settingsSection'), sidebar: 'main', init: 'initializeSettings' },
            'settings-instance-management': { title: 'Instance Management', nav: document.getElementById('movieHuntSettingsInstanceManagementNav'), section: document.getElementById('instanceManagementSection'), sidebar: 'moviehunt' },
            'settings-movie-management': { title: 'Movie Management', nav: document.getElementById('movieHuntSettingsMovieManagementNav'), section: document.getElementById('movieManagementSection'), sidebar: 'moviehunt' },
            'settings-profiles': { title: 'Profiles', nav: document.getElementById('movieHuntSettingsProfilesNav'), section: document.getElementById('settingsProfilesSection'), sidebar: 'moviehunt' },
            'profile-editor': { title: 'Profile Editor', nav: document.getElementById('movieHuntSettingsProfilesNav'), section: document.getElementById('profileEditorSection'), sidebar: 'moviehunt' },
            'settings-custom-formats': { title: 'Custom Formats', nav: document.getElementById('movieHuntSettingsCustomFormatsNav'), section: document.getElementById('settingsCustomFormatsSection'), sidebar: 'moviehunt' },
            'settings-indexers': { title: 'Indexers', nav: document.getElementById('movieHuntSettingsIndexersNav'), section: document.getElementById('settingsIndexersSection'), sidebar: 'moviehunt' },
            'settings-clients': { title: 'Clients', nav: document.getElementById('movieHuntSettingsClientsNav'), section: document.getElementById('settingsClientsSection'), sidebar: 'moviehunt' },
            'settings-root-folders': { title: 'Root Folders', nav: document.getElementById('movieHuntSettingsRootFoldersNav'), section: document.getElementById('settingsRootFoldersSection'), sidebar: 'moviehunt' },
            'settings-logs': { title: 'Log Settings', nav: document.getElementById('mainSettingsLogsNav'), section: document.getElementById('settingsLogsSection'), sidebar: 'main', init: 'initializeLogsSettings' },
            'scheduling': { title: 'Scheduling', nav: document.getElementById('mainSettingsSchedulingNav'), section: document.getElementById('schedulingSection'), sidebar: 'main' },
            'notifications': { title: 'Notifications', nav: document.getElementById('mainSettingsNotificationsNav'), section: document.getElementById('notificationsSection'), sidebar: 'main', init: 'initializeNotifications' },
            'backup-restore': { title: 'Backup / Restore', nav: document.getElementById('mainSettingsBackupRestoreNav'), section: document.getElementById('backupRestoreSection'), sidebar: 'main', init: 'initializeBackupRestore' },
            'prowlarr': { title: 'Prowlarr', nav: document.getElementById('appsProwlarrNav'), section: document.getElementById('prowlarrSection'), sidebar: 'apps', init: 'initializeProwlarr' },
            'user': { title: 'User', nav: document.getElementById('mainSettingsUserNav'), section: document.getElementById('userSection'), sidebar: 'main', init: 'initializeUser' },
            'instance-editor': { title: 'Instance Editor', section: document.getElementById('instanceEditorSection'), sidebar: 'apps' }
        };

        const config = sectionMap[section] || sectionMap['home'];
        ui.currentSection = section;
        newTitle = config.title;
        if (section === 'instance-editor' && window.SettingsForms && window.SettingsForms._currentEditing) {
            const appType = window.SettingsForms._currentEditing.appType;
            if (appType === 'indexer') {
                const inst = window.SettingsForms._currentEditing.originalInstance || {};
                const preset = (inst.preset || 'manual').toString().toLowerCase().trim();
                const label = (window.SettingsForms.getIndexerPresetLabel && window.SettingsForms.getIndexerPresetLabel(preset)) || 'Indexer';
                newTitle = label + ' Indexer Editor';
            } else if (appType === 'client') {
                const ct = (window.SettingsForms._currentEditing.originalInstance && window.SettingsForms._currentEditing.originalInstance.type) ? String(window.SettingsForms._currentEditing.originalInstance.type).toLowerCase() : 'nzbget';
                newTitle = (ct === 'sabnzbd' ? 'SABnzbd' : ct === 'nzbget' ? 'NZBGet' : ct) + ' Connection Settings';
            }
        }
        
        if (config.section) {
            config.section.classList.add('active');
            config.section.style.display = 'block';
        }
        if (config.nav) config.nav.classList.add('active');
        
        // Handle system tab switching
        if (config.systemTab) {
            this.switchSystemTab(config.systemTab);
        }

        if (config.sidebar === 'main') {
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            // Expand/collapse Settings sub (Main, Scheduling, Notifications, etc.)
            const settingsSub = document.getElementById('settings-sub');
            if (settingsSub) {
                if (['settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user'].indexOf(section) !== -1) settingsSub.classList.add('expanded');
                else settingsSub.classList.remove('expanded');
            }
            // Expand/collapse System sub (Hunt Manager, Logs, About)
            const systemSub = document.getElementById('system-sub');
            if (systemSub) {
                if (['system', 'hunt-manager', 'logs', 'about'].indexOf(section) !== -1) systemSub.classList.add('expanded');
                else systemSub.classList.remove('expanded');
            }
        } else if (config.sidebar === 'apps') {
            if (section === 'instance-editor' && window.SettingsForms && window.SettingsForms._currentEditing) {
                const appType = window.SettingsForms._currentEditing.appType;
                if (appType === 'indexer' || appType === 'client') this.showMovieHuntSidebar();
                else this.showAppsSidebar();
            } else {
                this.showAppsSidebar();
            }
        } else if (config.sidebar === 'settings') {
            localStorage.setItem('huntarr-settings-sidebar', 'true');
            this.showSettingsSidebar();
        } else if (config.sidebar === 'requestarr') {
            this.showRequestarrSidebar();
        } else if (config.sidebar === 'moviehunt') {
            this.showMovieHuntSidebar();
        }

        if (section === 'home') {
            if (ui.checkAppConnections) ui.checkAppConnections();
            if (ui.loadSwaparrStatus) ui.loadSwaparrStatus();
        } else if (section === 'logs' || section === 'logs-movie-hunt') {
            if (section === 'logs-movie-hunt') {
                const logAppSelect = document.getElementById('logAppSelect');
                if (logAppSelect) logAppSelect.value = 'movie_hunt';
                if (window.LogsModule) window.LogsModule.currentLogApp = 'movie_hunt';
            }
            if (window.LogsModule?.init) window.LogsModule.init();
        } else if (section === 'hunt-manager' || section === 'system') {
            if (window.huntManagerModule?.refresh) window.huntManagerModule.refresh();
        }
        
        if (config.view && section.startsWith('requestarr') && ui.runWhenRequestarrReady) {
            ui.runWhenRequestarrReady(config.view, () => window.RequestarrDiscover.switchView(config.view));
        }
        if (section === 'movie-hunt-home' && window.MovieHunt && typeof window.MovieHunt.init === 'function') {
            window.MovieHunt.init();
        }
        if (section === 'settings-movie-management' && window.MovieManagement && typeof window.MovieManagement.load === 'function') {
            window.MovieManagement.load();
        }
        if (section === 'settings-profiles' && window.SettingsForms && typeof window.SettingsForms.refreshProfilesList === 'function') {
            window.SettingsForms.refreshProfilesList();
        }
        if (section === 'settings-custom-formats' && window.CustomFormats && typeof window.CustomFormats.refreshList === 'function') {
            window.CustomFormats.refreshList();
        }
        if (section === 'settings-indexers' && window.SettingsForms && typeof window.SettingsForms.refreshIndexersList === 'function') {
            window.SettingsForms.refreshIndexersList();
        }
        if (section === 'settings-clients' && window.SettingsForms && typeof window.SettingsForms.refreshClientsList === 'function') {
            window.SettingsForms.refreshClientsList();
        }
        if (section === 'settings-root-folders' && window.RootFolders && typeof window.RootFolders.refreshList === 'function') {
            window.RootFolders.refreshList();
        }
        if ((section === 'activity-queue' || section === 'activity-history' || section === 'activity-blocklist' || section === 'activity-logs') && window.ActivityModule && typeof window.ActivityModule.init === 'function') {
            var view = section === 'activity-queue' ? 'queue' : section === 'activity-history' ? 'history' : section === 'activity-blocklist' ? 'blocklist' : 'logs';
            window.ActivityModule.init(view);
        }
        
        if (config.app && typeof appsModule !== 'undefined') {
            appsModule.init(config.app);
        }
        
        if (config.init && ui[config.init]) {
            ui[config.init]();
        }

        if (ui.currentSection !== 'logs' && window.LogsModule?.disconnectAllEventSources) {
            window.LogsModule.disconnectAllEventSources();
        }

        const pageTitle = document.getElementById('currentPageTitle');
        if (pageTitle) {
            pageTitle.textContent = newTitle;
            if (typeof window.updateMobilePageTitle === 'function') window.updateMobilePageTitle(newTitle);
        }
    },
    
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

        // When on System (Hunt Manager, Logs, About), hide Apps, Requestarr, Settings in main sidebar
        // When on Settings (Main, Scheduling, etc.), hide Apps, Requestarr, System in main sidebar
        var section = window.huntarrUI && window.huntarrUI.currentSection;
        var onSystem = section === 'system' || section === 'hunt-manager' || section === 'logs' || section === 'about';
        var onSettings = ['settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user'].indexOf(section) !== -1;
        var settingsNav = document.getElementById('settingsNav');
        var requestarrNav = document.getElementById('requestarrNav');
        var appsNav = document.getElementById('appsNav');
        var systemNav = document.getElementById('systemNav');
        var settingsSubGroup = document.getElementById('settings-sub');
        var systemSubGroup = document.getElementById('system-sub');
        if (settingsNav) settingsNav.style.display = onSystem ? 'none' : '';
        if (settingsSubGroup) settingsSubGroup.style.display = onSystem ? 'none' : '';
        if (requestarrNav) requestarrNav.style.display = (onSystem || onSettings) ? 'none' : '';
        if (appsNav) appsNav.style.display = (onSystem || onSettings) ? 'none' : '';
        if (systemNav) systemNav.style.display = onSettings ? 'none' : '';
        if (systemSubGroup) systemSubGroup.style.display = onSettings ? 'none' : '';
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

    updateMovieHuntSidebarActive: function() {
        if (!window.huntarrUI) return;
        const currentSection = window.huntarrUI.currentSection;
        // When editing indexer or client (instance-editor), highlight the corresponding sidebar item
        let sectionForNav = currentSection;
        if (currentSection === 'instance-editor' && window.SettingsForms && window.SettingsForms._currentEditing) {
            const appType = window.SettingsForms._currentEditing.appType;
            if (appType === 'indexer') sectionForNav = 'settings-indexers';
            else if (appType === 'client') sectionForNav = 'settings-clients';
        }
        const items = document.querySelectorAll('#movie-hunt-sidebar .nav-item');
        const isActivitySub = ['activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-movie-hunt'].indexOf(sectionForNav) !== -1;
        items.forEach(item => {
            item.classList.remove('active');
            if (isActivitySub && item.id === 'movieHuntActivityNav') return;
            const href = item.getAttribute && item.getAttribute('href') || (item.querySelector('a') && item.querySelector('a').getAttribute('href'));
            if (href && (href === '#' + sectionForNav || href.endsWith('#' + sectionForNav))) {
                item.classList.add('active');
            }
        });
        var subGroup = document.getElementById('movie-hunt-settings-sub');
        if (subGroup) {
            var showSub = ['movie-hunt-settings', 'settings-instance-management', 'settings-movie-management', 'settings-profiles', 'profile-editor', 'settings-custom-formats', 'settings-indexers', 'settings-clients', 'settings-root-folders', 'instance-editor'].indexOf(currentSection) !== -1;
            subGroup.classList.toggle('expanded', showSub);
        }
        var activitySub = document.getElementById('movie-hunt-activity-sub');
        if (activitySub) {
            var showActivitySub = ['activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-movie-hunt'].indexOf(currentSection) !== -1;
            activitySub.classList.toggle('expanded', showActivitySub);
        }
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

    setupRequestarrNavigation: function() {
        console.log('[Navigation] Setting up requestarr navigation');
        
        const requestarrNavItems = document.querySelectorAll('#requestarr-sidebar .nav-item a');
        requestarrNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const href = item.getAttribute('href');
                if (href) {
                    window.location.hash = href;
                }
            });
        });
    },

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

    updateRequestarrNavigation: function(view) {
        if (!window.RequestarrDiscover || !window.RequestarrDiscover.switchView) {
            console.warn('[Navigation] RequestarrDiscover not available');
            return;
        }
        window.RequestarrDiscover.switchView(view);
    }
};
