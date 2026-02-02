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
            
            const noRefresh = ['instance-editor', 'profile-editor', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'swaparr', 'movie-hunt-home', 'movie-hunt-collection', 'movie-hunt-settings', 'settings-profiles', 'settings-indexers', 'settings-clients', 'settings-root-folders'];
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
            'logs': { title: 'Logs', nav: ui.elements.logsNav, section: ui.elements.logsSection, sidebar: 'main' },
            'hunt-manager': { title: 'Hunt Manager', nav: ui.elements.huntManagerNav, section: document.getElementById('huntManagerSection'), sidebar: 'main' },
            'movie-hunt-home': { title: 'Movie Hunt', nav: document.getElementById('movieHuntHomeNav'), section: document.getElementById('movie-hunt-section'), sidebar: 'moviehunt', view: 'movies' },
            'movie-hunt-collection': { title: 'Media Collection', nav: document.getElementById('movieHuntCollectionNav'), section: document.getElementById('movie-hunt-section'), sidebar: 'moviehunt', view: 'collection' },
            'movie-hunt-settings': { title: 'Movie Hunt Settings', nav: document.getElementById('movieHuntSettingsNav'), section: document.getElementById('requestarr-section'), sidebar: 'moviehunt', view: 'settings' },
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
            'swaparr': { title: 'Swaparr', nav: document.getElementById('swaparrNav'), section: document.getElementById('swaparrSection'), sidebar: 'main', init: 'initializeSwaparr' },
            'settings': { title: 'Settings', nav: document.getElementById('settingsNav'), section: document.getElementById('settingsSection'), sidebar: 'settings', init: 'initializeSettings' },
            'settings-profiles': { title: 'Profiles', nav: document.getElementById('movieHuntSettingsProfilesNav'), section: document.getElementById('settingsProfilesSection'), sidebar: 'moviehunt' },
            'profile-editor': { title: 'Profile Editor', nav: document.getElementById('movieHuntSettingsProfilesNav'), section: document.getElementById('profileEditorSection'), sidebar: 'moviehunt' },
            'settings-indexers': { title: 'Indexers', nav: document.getElementById('movieHuntSettingsIndexersNav'), section: document.getElementById('settingsIndexersSection'), sidebar: 'moviehunt' },
            'settings-clients': { title: 'Clients', nav: document.getElementById('movieHuntSettingsClientsNav'), section: document.getElementById('settingsClientsSection'), sidebar: 'moviehunt' },
            'settings-root-folders': { title: 'Root Folders', nav: document.getElementById('movieHuntSettingsRootFoldersNav'), section: document.getElementById('settingsRootFoldersSection'), sidebar: 'moviehunt' },
            'settings-logs': { title: 'Log Settings', nav: document.getElementById('settingsLogsNav'), section: document.getElementById('settingsLogsSection'), sidebar: 'settings', init: 'initializeLogsSettings' },
            'scheduling': { title: 'Scheduling', nav: document.getElementById('schedulingNav'), section: document.getElementById('schedulingSection'), sidebar: 'settings' },
            'notifications': { title: 'Notifications', nav: document.getElementById('settingsNotificationsNav'), section: document.getElementById('notificationsSection'), sidebar: 'settings', init: 'initializeNotifications' },
            'backup-restore': { title: 'Backup / Restore', nav: document.getElementById('settingsBackupRestoreNav'), section: document.getElementById('backupRestoreSection'), sidebar: 'settings', init: 'initializeBackupRestore' },
            'prowlarr': { title: 'Prowlarr', nav: document.getElementById('appsProwlarrNav'), section: document.getElementById('prowlarrSection'), sidebar: 'apps', init: 'initializeProwlarr' },
            'user': { title: 'User', nav: document.getElementById('userNav'), section: document.getElementById('userSection'), sidebar: 'settings', init: 'initializeUser' },
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
        
        if (config.sidebar === 'main') {
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
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
        } else if (section === 'logs') {
            if (window.LogsModule?.init) window.LogsModule.init();
        } else if (section === 'hunt-manager') {
            if (window.huntManagerModule?.refresh) window.huntManagerModule.refresh();
        }
        
        if (config.view && section.startsWith('requestarr') && ui.runWhenRequestarrReady) {
            ui.runWhenRequestarrReady(config.view, () => window.RequestarrDiscover.switchView(config.view));
        }
        if (section === 'movie-hunt-home' && window.MovieHunt && typeof window.MovieHunt.init === 'function') {
            window.MovieHunt.init();
        }
        if (section === 'settings-profiles' && window.SettingsForms && typeof window.SettingsForms.refreshProfilesList === 'function') {
            window.SettingsForms.refreshProfilesList();
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
        items.forEach(item => {
            item.classList.remove('active');
            const href = item.getAttribute && item.getAttribute('href') || (item.querySelector('a') && item.querySelector('a').getAttribute('href'));
            if (href && (href === '#' + sectionForNav || href.endsWith('#' + sectionForNav))) {
                item.classList.add('active');
            }
        });
        var subGroup = document.getElementById('movie-hunt-settings-sub');
        if (subGroup) {
            var showSub = ['movie-hunt-settings', 'settings-profiles', 'profile-editor', 'settings-indexers', 'settings-clients', 'settings-root-folders', 'instance-editor'].indexOf(currentSection) !== -1;
            subGroup.classList.toggle('expanded', showSub);
        }
    },

    updateAppsSidebarActive: function() {
        if (!window.huntarrUI) return;
        
        const currentSection = window.huntarrUI.currentSection;
        const appsSidebarItems = document.querySelectorAll('#apps-sidebar .nav-item');
        
        appsSidebarItems.forEach(item => {
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
