/**
 * Huntarr - Section Switching Logic
 * Extracted from app.js to reduce file size.
 * Contains the switchSection() method that handles all section navigation.
 * Loaded after app.js in bundle-app.js — uses Object.assign to extend huntarrUI.
 */

Object.assign(huntarrUI, {

    switchSection: function(section) {
        console.log(`[huntarrUI] *** SWITCH SECTION CALLED *** section: ${section}, current: ${this.currentSection}`);
        // Redirect legacy Movie Hunt home to Media Collection (discovery is under Requestarr)
        if (section === 'movie-hunt-home') section = 'movie-hunt-collection';
        // Redirect tv-hunt-settings and movie-hunt-settings to unified media-hunt-settings
        if (section === 'tv-hunt-settings') { section = 'media-hunt-settings'; this._pendingMediaHuntSidebar = 'tv'; }
        else if (section === 'movie-hunt-settings') { section = 'media-hunt-settings'; this._pendingMediaHuntSidebar = 'movie'; }
        // Redirect tv-hunt-collection and movie-hunt-collection to unified media-hunt-collection
        if (section === 'tv-hunt-collection') { section = 'media-hunt-collection'; this._pendingMediaHuntSidebar = 'tv'; }
        else if (section === 'movie-hunt-collection') { section = 'media-hunt-collection'; this._pendingMediaHuntSidebar = 'movie'; }
        // Redirect movie-hunt-calendar and tv-hunt-calendar to unified media-hunt-calendar
        if (section === 'movie-hunt-calendar') { section = 'media-hunt-calendar'; this._pendingMediaHuntCalendarMode = 'movie'; }
        else if (section === 'tv-hunt-calendar') { section = 'media-hunt-calendar'; this._pendingMediaHuntCalendarMode = 'tv'; }
        // Redirect tv-hunt-settings-sizes to unified settings-sizes
        if (section === 'tv-hunt-settings-sizes') { section = 'settings-sizes'; this._pendingSizesMode = 'tv'; }
        // Backward compat: requestarr-services → requestarr-bundles
        if (section === 'requestarr-services') section = 'requestarr-bundles';

        // Feature flag guards: redirect to home if section is disabled
        var requestarrSections = ['requestarr', 'requestarr-discover', 'requestarr-movies', 'requestarr-tv', 'requestarr-smarthunt', 'requestarr-hidden', 'requestarr-personal-blacklist', 'requestarr-filters', 'requestarr-settings', 'requestarr-smarthunt-settings', 'requestarr-users', 'requestarr-bundles', 'requestarr-requests', 'requestarr-global-blacklist'];
        var mediaHuntSections = ['media-hunt-collection', 'media-hunt-settings', 'media-hunt-instances', 'media-hunt-calendar', 'activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-media-hunt', 'indexer-hunt', 'indexer-hunt-stats', 'indexer-hunt-history', 'settings-clients', 'settings-media-management', 'settings-profiles', 'settings-sizes', 'settings-custom-formats', 'settings-import-lists', 'settings-import-media', 'settings-root-folders', 'settings-instance-management', 'movie-hunt-instance-editor', 'profile-editor'];
        var nzbHuntSections = ['nzb-hunt-home', 'nzb-hunt-activity', 'nzb-hunt-folders', 'nzb-hunt-servers', 'nzb-hunt-advanced', 'nzb-hunt-server-editor'];
        var thirdPartyAppSections = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'swaparr'];
        if (this._enableRequestarr === false && requestarrSections.indexOf(section) !== -1) {
            console.log('[huntarrUI] Requests disabled - redirecting to home');
            this.switchSection('home'); return;
        }
        var torHuntSections = ['tor-hunt-home', 'tor-hunt-settings'];
        if (this._enableMediaHunt === false && (mediaHuntSections.indexOf(section) !== -1 || nzbHuntSections.indexOf(section) !== -1 || torHuntSections.indexOf(section) !== -1 || (section && section.indexOf('nzb-hunt') === 0) || (section && section.indexOf('tor-hunt') === 0))) {
            console.log('[huntarrUI] Media Hunt disabled - redirecting to home');
            this.switchSection('home'); return;
        }
        if (this._enableThirdPartyApps === false && thirdPartyAppSections.indexOf(section) !== -1) {
            console.log('[huntarrUI] 3rd Party Apps disabled - redirecting to home');
            this.switchSection('home'); return;
        }

        // Role-based guard: restrict non-owner users to allowed sections only
        if (this._userRole && this._userRole !== 'owner' && this.isAdminOnlySection(section)) {
            console.log('[huntarrUI] Non-owner role restricted - redirecting to discover');
            this.switchSection('requestarr-discover'); return;
        }

        // Check for unsaved changes before allowing navigation
        if (this.isInitialized && this.currentSection && this.currentSection !== section) {
            // Check for unsaved Swaparr changes if leaving Swaparr section
            if (this.currentSection === 'swaparr' && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[huntarrUI] Navigation cancelled due to unsaved Swaparr changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved Settings changes if leaving Settings section
            if (this.currentSection === 'settings' && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[huntarrUI] Navigation cancelled due to unsaved Settings changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved Notifications changes if leaving Notifications section
            if (this.currentSection === 'notifications' && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[huntarrUI] Navigation cancelled due to unsaved Notifications changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved App instance changes if leaving Apps section
            const appSections = ['apps'];
            if (appSections.includes(this.currentSection) && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[huntarrUI] Navigation cancelled due to unsaved App changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved Prowlarr changes if leaving Prowlarr section
            if (this.currentSection === 'prowlarr' && window.SettingsForms && typeof window.SettingsForms.checkUnsavedChanges === 'function') {
                if (!window.SettingsForms.checkUnsavedChanges()) {
                    console.log(`[huntarrUI] Navigation cancelled due to unsaved Prowlarr changes`);
                    return; // User chose to stay and save changes
                }
            }
            
            // Check for unsaved Profile Editor changes if leaving Profile Editor
            if (this.currentSection === 'profile-editor' && section !== 'profile-editor' && window.SettingsForms && typeof window.SettingsForms.isProfileEditorDirty === 'function' && window.SettingsForms.isProfileEditorDirty()) {
                window.SettingsForms.confirmLeaveProfileEditor(function(result) {
                    if (result === 'save') {
                        window.SettingsForms.saveProfileFromEditor(section);
                    } else if (result === 'discard') {
                        window.SettingsForms.cancelProfileEditor(section);
                    }
                });
                return;
            }

            // Check for unsaved Movie Management changes if leaving Movie Management
            if (this.currentSection === 'settings-media-management' && section !== 'settings-media-management' && window.MovieManagement && typeof window.MovieManagement.isDirty === 'function' && window.MovieManagement.isDirty()) {
                window.MovieManagement.confirmLeave(function(result) {
                    if (result === 'save') {
                        window.MovieManagement.save(section);
                    } else if (result === 'discard') {
                        window.MovieManagement.cancel(section);
                    }
                });
                return;
            }

            // Check for unsaved TV Management changes if leaving TV Management
            if (this.currentSection === 'tv-hunt-settings-tv-management' && section !== 'tv-hunt-settings-tv-management' && window.TVManagement && typeof window.TVManagement.isDirty === 'function' && window.TVManagement.isDirty()) {
                window.TVManagement.confirmLeave(function(result) {
                    if (result === 'save') {
                        window.TVManagement.save(section);
                    } else if (result === 'discard') {
                        window.TVManagement.cancel(section);
                    }
                });
                return;
            }

            // Check for unsaved Instance Editor changes if leaving Instance Editor
            if (this.currentSection === 'instance-editor' && section !== 'instance-editor' && window.SettingsForms && typeof window.SettingsForms.confirmLeaveInstanceEditor === 'function' && typeof window.SettingsForms.isInstanceEditorDirty === 'function' && window.SettingsForms.isInstanceEditorDirty()) {
                window.SettingsForms.confirmLeaveInstanceEditor((result) => {
                    if (result === 'save') {
                        // true means navigate back after save
                        window.SettingsForms._instanceEditorNextSection = section;
                        window.SettingsForms.saveInstanceFromEditor(true); 
                    } else if (result === 'discard') {
                        window.SettingsForms.cancelInstanceEditor(section);
                    }
                });
                return;
            }

            // Check for unsaved NZB Hunt server editor changes if leaving server editor
            if (this.currentSection === 'nzb-hunt-server-editor' && section !== 'nzb-hunt-server-editor' && window.NzbHunt && typeof window.NzbHunt._isServerEditorDirty === 'function' && window.NzbHunt._isServerEditorDirty()) {
                window.NzbHunt._confirmLeaveServerEditor(section);
                return;
            }
            
            // Don't refresh page when navigating to/from instance editor or between app sections
            const noRefreshSections = ['home', 'instance-editor', 'profile-editor', 'movie-hunt-instance-editor', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'swaparr', 'movie-hunt-home', 'movie-hunt-collection', 'media-hunt-collection', 'media-hunt-calendar', 'activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-media-hunt', 'movie-hunt-settings', 'media-hunt-settings', 'media-hunt-instances', 'settings-instance-management', 'settings-media-management', 'settings-profiles', 'settings-sizes', 'settings-indexers', 'settings-clients', 'settings-import-lists', 'settings-import-media', 'settings-custom-formats', 'settings-root-folders', 'tv-hunt-collection', 'media-hunt-collection', 'tv-hunt-settings', 'media-hunt-settings', 'tv-hunt-settings-profiles', 'tv-hunt-settings-sizes', 'tv-hunt-settings-custom-formats', 'tv-hunt-settings-indexers', 'tv-hunt-settings-clients', 'tv-hunt-settings-import-lists', 'tv-hunt-settings-root-folders', 'tv-hunt-settings-tv-management', 'tv-hunt-activity-queue', 'tv-hunt-activity-history', 'tv-hunt-activity-blocklist', 'tv-hunt-instance-editor', 'logs-tv-hunt', 'system', 'hunt-manager', 'logs', 'about', 'settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user', 'nzb-hunt-home', 'nzb-hunt-activity', 'nzb-hunt-folders', 'nzb-hunt-servers', 'nzb-hunt-advanced', 'nzb-hunt-settings', 'nzb-hunt-settings-folders', 'nzb-hunt-settings-servers', 'nzb-hunt-settings-processing', 'nzb-hunt-settings-advanced', 'nzb-hunt-server-editor', 'tor-hunt-home', 'tor-hunt-settings', 'requestarr', 'requestarr-discover', 'requestarr-movies', 'requestarr-tv', 'requestarr-hidden', 'requestarr-personal-blacklist', 'requestarr-filters', 'requestarr-settings', 'requestarr-smarthunt', 'requestarr-smarthunt-settings', 'requestarr-users', 'requestarr-bundles', 'requestarr-requests', 'requestarr-global-blacklist', 'indexer-hunt', 'indexer-hunt-stats', 'indexer-hunt-history'];
            const skipRefresh = noRefreshSections.includes(section) || noRefreshSections.includes(this.currentSection);
            
            if (!skipRefresh) {
                console.log(`[huntarrUI] User switching from ${this.currentSection} to ${section}, refreshing page...`);
                // Store the target section in localStorage so we can navigate to it after refresh
                localStorage.setItem('huntarr-target-section', section);
                location.reload();
                return;
            } else {
                console.log(`[huntarrUI] Switching from ${this.currentSection} to ${section} without page refresh (app/editor navigation)`);
            }
        }
        
        // Stop stats polling when leaving home section
        if (window.HuntarrStats) window.HuntarrStats.stopPolling();

        // Stop NZB Hunt queue/history polling when leaving NZB Hunt home
        if (this.currentSection === 'nzb-hunt-home' && window.NzbHunt && typeof window.NzbHunt.stopPolling === 'function') {
            window.NzbHunt.stopPolling();
        }

        // Stop Tor Hunt polling when leaving Tor Hunt home
        if (this.currentSection === 'tor-hunt-home' && window.TorHunt && typeof window.TorHunt.stopPolling === 'function') {
            window.TorHunt.stopPolling();
        }

        // Clean up cycle countdown when leaving home (stops timer intervals and API polling)
        if (this.currentSection === 'home' && window.CycleCountdown && typeof window.CycleCountdown.cleanup === 'function') {
            window.CycleCountdown.cleanup();
        }

        // Clean up Media Hunt collection when leaving (stops refresh interval and visibility listener)
        if (this.currentSection === 'media-hunt-collection' && section !== 'media-hunt-collection' && window.MediaHuntCollection && typeof window.MediaHuntCollection.cleanup === 'function') {
            window.MediaHuntCollection.cleanup();
        }

        // Update active section
        this.elements.sections.forEach(s => {
            s.classList.remove('active');
            s.style.display = 'none';
        });
        
        // Additionally, make sure scheduling section is completely hidden
        if (section !== 'scheduling' && this.elements.schedulingSection) {
            this.elements.schedulingSection.style.display = 'none';
        }
        
        // Update navigation
        this.elements.navItems.forEach(item => {
            item.classList.remove('active');
        });
        
        // Show selected section
        let newTitle = 'Home'; // Default title
        const sponsorsSection = document.getElementById('sponsorsSection'); // Get sponsors section element
        const sponsorsNav = document.getElementById('sponsorsNav'); // Get sponsors nav element

        if (section === 'home' && this.elements.homeSection) {
            this.elements.homeSection.classList.add('active');
            this.elements.homeSection.style.display = 'block';
            if (this.elements.homeNav) this.elements.homeNav.classList.add('active');
            newTitle = 'Home';
            this.currentSection = 'home';
            
            // Show main sidebar when returning to home
            this.showMainSidebar();
            
            // Disconnect logs if switching away from logs
            this.disconnectAllEventSources(); 
            
            // Check app connections when returning to home page to update status
            // This will call updateEmptyStateVisibility() after all checks complete
            this.checkAppConnections();
            // Load Swaparr status
            this.loadSwaparrStatus();
            // Refresh stats when returning to home section
            this.loadMediaStats();
            // Initialize view toggle and start live polling
            if (window.HuntarrStats) {
                window.HuntarrStats.initViewToggle();
                window.HuntarrStats.startPolling();
            }
            // Re-initialize cycle countdown when returning to home (cleanup stops it when leaving)
            if (window.CycleCountdown && typeof window.CycleCountdown.initialize === 'function') {
                window.CycleCountdown.initialize();
            }
            // Refresh home page content (re-check all settings, visibility, Smart Hunt)
            if (window.HomeRequestarr) {
                window.HomeRequestarr.refresh();
            }
            // Show welcome message on first visit (not during setup wizard)
            this._maybeShowWelcome();
        } else if (section === 'logs-media-hunt' && this.elements.logsSection) {
            // Media Hunt logs - show logsSection under Movie Hunt sidebar (hide tab bar)
            var activitySection = document.getElementById('activitySection');
            if (activitySection) { activitySection.classList.remove('active'); activitySection.style.display = 'none'; }
            var systemSection = document.getElementById('systemSection');
            if (systemSection) { systemSection.classList.add('active'); systemSection.style.display = 'block'; }
            if (window.HuntarrNavigation) window.HuntarrNavigation.switchSystemTab('logs');
            newTitle = 'Logs';
            this.currentSection = section;
            this.showMovieHuntSidebar();
            _checkLogsMediaHuntInstances(function(state) {
                var noInst = document.getElementById('logs-media-hunt-no-instances');
                var noIdx = document.getElementById('logs-media-hunt-no-indexers');
                var noCli = document.getElementById('logs-media-hunt-no-clients');
                var wrapper = document.getElementById('logs-media-hunt-content-wrapper');
                if (noInst) noInst.style.display = (state === 'no-instances') ? '' : 'none';
                if (noIdx) noIdx.style.display = (state === 'no-indexers') ? '' : 'none';
                if (noCli) noCli.style.display = (state === 'no-clients') ? '' : 'none';
                if (wrapper) wrapper.style.display = (state === 'ok') ? '' : 'none';
            });
            var logAppSelect = document.getElementById('logAppSelect');
            if (logAppSelect) logAppSelect.value = 'media_hunt';
            if (window.LogsModule) window.LogsModule.currentLogApp = 'media_hunt';
            if (window.LogsModule && typeof window.LogsModule.setAppFilterContext === 'function') {
                window.LogsModule.setAppFilterContext('media-hunt');
            }
            if (window.LogsModule && typeof window.LogsModule.updateDebugLevelVisibility === 'function') {
                window.LogsModule.updateDebugLevelVisibility();
            }
            if (window.LogsModule) {
                try {
                    if (window.LogsModule.initialized) { window.LogsModule.connectToLogs(); }
                    else { window.LogsModule.init(); }
                } catch (error) { console.error('[huntarrUI] Error during LogsModule calls:', error); }
            }
        } else if (section === 'about') {
            // About removed — redirect to home
            this.switchSection('home'); return;
        } else if ((section === 'system' || section === 'hunt-manager' || section === 'logs') && document.getElementById('systemSection')) {
            // System section with sidebar sub-navigation (Hunt Manager, Logs)
            var systemSection = document.getElementById('systemSection');
            systemSection.classList.add('active');
            systemSection.style.display = 'block';
            
            // Determine which tab to show
            var activeTab = section === 'system' ? 'hunt-manager' : section;
            if (window.HuntarrNavigation) window.HuntarrNavigation.switchSystemTab(activeTab);
            
            // Set title based on active tab
            var tabTitles = { 'hunt-manager': 'Hunt Manager', 'logs': 'Logs' };
            newTitle = tabTitles[activeTab] || 'System';
            this.currentSection = section === 'system' ? 'hunt-manager' : section;
            
            // Expand System group in unified sidebar
            if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-system');
            if (typeof setActiveNavItem === 'function') setActiveNavItem();
            
            // Initialize the active tab's module
            if (activeTab === 'hunt-manager') {
                if (typeof huntManagerModule !== 'undefined') huntManagerModule.refresh();
            } else if (activeTab === 'logs') {
                var noInstLogs = document.getElementById('logs-media-hunt-no-instances');
                var wrapperLogs = document.getElementById('logs-media-hunt-content-wrapper');
                if (noInstLogs) noInstLogs.style.display = 'none';
                if (wrapperLogs) wrapperLogs.style.display = '';
                if (window.LogsModule && typeof window.LogsModule.setAppFilterContext === 'function') {
                    window.LogsModule.setAppFilterContext('system');
                }
                if (window.LogsModule && typeof window.LogsModule.updateDebugLevelVisibility === 'function') {
                    window.LogsModule.updateDebugLevelVisibility();
                }
                if (window.LogsModule) {
                    try {
                        if (window.LogsModule.initialized) { window.LogsModule.connectToLogs(); }
                        else { window.LogsModule.init(); }
                    } catch (error) { console.error('[huntarrUI] Error during LogsModule calls:', error); }
                }
            }
        } else if (section === 'nzb-hunt-home' && document.getElementById('nzb-hunt-section')) {
            if (!this._enableNzbHunt) { this.switchSection('home'); return; }
            document.getElementById('nzb-hunt-section').classList.add('active');
            document.getElementById('nzb-hunt-section').style.display = 'block';
            newTitle = 'NZB Hunt';
            this.currentSection = 'nzb-hunt-home';
            this.showNzbHuntSidebar();
            if (window.NzbHunt && typeof window.NzbHunt.init === 'function') {
                window.NzbHunt.init();
            }
        } else if (section === 'nzb-hunt-activity' && document.getElementById('nzb-hunt-activity-section')) {
            if (!this._enableNzbHunt) { this.switchSection('home'); return; }
            document.getElementById('nzb-hunt-activity-section').classList.add('active');
            document.getElementById('nzb-hunt-activity-section').style.display = 'block';
            newTitle = 'NZB Hunt – Activity';
            this.currentSection = 'nzb-hunt-activity';
            this.showNzbHuntSidebar();
        } else if ((section === 'nzb-hunt-folders' || section === 'nzb-hunt-servers' || section === 'nzb-hunt-advanced' || section.startsWith('nzb-hunt-settings')) && document.getElementById('nzb-hunt-settings-section')) {
            if (!this._enableNzbHunt) { this.switchSection('home'); return; }
            document.getElementById('nzb-hunt-settings-section').classList.add('active');
            document.getElementById('nzb-hunt-settings-section').style.display = 'block';
            var tab = 'folders';
            if (section === 'nzb-hunt-servers' || section === 'nzb-hunt-settings-servers') tab = 'servers';
            else if (section === 'nzb-hunt-advanced' || section === 'nzb-hunt-settings-advanced') tab = 'advanced';
            newTitle = 'NZB Hunt – ' + (tab.charAt(0).toUpperCase() + tab.slice(1));
            this.currentSection = section;
            this.showNzbHuntSidebar();
            if (window.NzbHunt && typeof window.NzbHunt.initSettings === 'function') {
                window.NzbHunt.initSettings();
            }
            if (window.NzbHunt && typeof window.NzbHunt._showSettingsTab === 'function') {
                window.NzbHunt._showSettingsTab(tab);
            }
        } else if (section === 'nzb-hunt-server-editor' && document.getElementById('nzb-hunt-server-editor-section')) {
            if (!this._enableNzbHunt) { this.switchSection('home'); return; }
            document.getElementById('nzb-hunt-server-editor-section').classList.add('active');
            document.getElementById('nzb-hunt-server-editor-section').style.display = 'block';
            newTitle = 'NZB Hunt – Usenet Server';
            this.currentSection = 'nzb-hunt-server-editor';
            this.showNzbHuntSidebar();
            if (window.NzbHunt) {
                if (typeof window.NzbHunt.initSettings === 'function') window.NzbHunt.initSettings();
                if (typeof window.NzbHunt._populateServerEditorForm === 'function') window.NzbHunt._populateServerEditorForm();
            }
        // ── Tor Hunt sections ─────────────────────────────────────────
        } else if (section === 'tor-hunt-home' && document.getElementById('tor-hunt-section')) {
            if (this._enableMediaHunt === false) { this.switchSection('home'); return; }
            document.getElementById('tor-hunt-section').classList.add('active');
            document.getElementById('tor-hunt-section').style.display = 'block';
            newTitle = 'Tor Hunt';
            this.currentSection = 'tor-hunt-home';
            this.showTorHuntSidebar();
            if (window.TorHunt && typeof window.TorHunt.init === 'function') {
                window.TorHunt.init();
            }
            if (window.TorHunt && typeof window.TorHunt.showView === 'function') {
                window.TorHunt.showView('downloads');
            }
        } else if (section === 'tor-hunt-settings' && document.getElementById('tor-hunt-section')) {
            if (this._enableMediaHunt === false) { this.switchSection('home'); return; }
            document.getElementById('tor-hunt-section').classList.add('active');
            document.getElementById('tor-hunt-section').style.display = 'block';
            newTitle = 'Tor Hunt – Settings';
            this.currentSection = 'tor-hunt-settings';
            this.showTorHuntSidebar();
            if (window.TorHunt && typeof window.TorHunt.init === 'function') {
                window.TorHunt.init();
            }
            if (window.TorHunt && typeof window.TorHunt.showView === 'function') {
                window.TorHunt.showView('settings');
            }
        // ── Indexer Hunt sections ──────────────────────────────────────
        } else if (section === 'indexer-hunt' && document.getElementById('indexer-hunt-section')) {
            document.getElementById('indexer-hunt-section').classList.add('active');
            document.getElementById('indexer-hunt-section').style.display = 'block';
            newTitle = 'Indexer Manager';
            this.currentSection = 'indexer-hunt';
            this.showMovieHuntSidebar();
            if (window.IndexerHunt && typeof window.IndexerHunt.init === 'function') {
                window.IndexerHunt.init();
            }
            if (window.SettingsForms && typeof window.SettingsForms.initOrRefreshIndexers === 'function') {
                window.SettingsForms.initOrRefreshIndexers();
            }
        } else if (section === 'indexer-hunt-stats' && document.getElementById('indexer-hunt-stats-section')) {
            document.getElementById('indexer-hunt-stats-section').classList.add('active');
            document.getElementById('indexer-hunt-stats-section').style.display = 'block';
            newTitle = 'Indexer Manager – Stats';
            this.currentSection = 'indexer-hunt-stats';
            this.showMovieHuntSidebar();
            if (window.IndexerHuntStats && typeof window.IndexerHuntStats.init === 'function') {
                window.IndexerHuntStats.init();
            }
        } else if (section === 'indexer-hunt-history' && document.getElementById('indexer-hunt-history-section')) {
            document.getElementById('indexer-hunt-history-section').classList.add('active');
            document.getElementById('indexer-hunt-history-section').style.display = 'block';
            newTitle = 'Indexer Manager – History';
            this.currentSection = 'indexer-hunt-history';
            this.showMovieHuntSidebar();
            if (window.IndexerHuntHistory && typeof window.IndexerHuntHistory.init === 'function') {
                window.IndexerHuntHistory.init();
            }
        } else if (section === 'logs-tv-hunt' && this.elements.logsSection) {
            // TV Hunt logs - show logsSection under TV Hunt sidebar (same as logs-media-hunt, different sidebar)
            var activitySection = document.getElementById('activitySection');
            if (activitySection) { activitySection.classList.remove('active'); activitySection.style.display = 'none'; }
            if (document.getElementById('tvHuntActivitySection')) {
                document.getElementById('tvHuntActivitySection').classList.remove('active');
                document.getElementById('tvHuntActivitySection').style.display = 'none';
            }
            var systemSection = document.getElementById('systemSection');
            if (systemSection) { systemSection.classList.add('active'); systemSection.style.display = 'block'; }
            if (window.HuntarrNavigation) window.HuntarrNavigation.switchSystemTab('logs');
            newTitle = 'Logs';
            this.currentSection = section;
            this.showTVHuntSidebar();
            _checkLogsMediaHuntInstances(function(state) {
                var noInst = document.getElementById('logs-media-hunt-no-instances');
                var noIdx = document.getElementById('logs-media-hunt-no-indexers');
                var noCli = document.getElementById('logs-media-hunt-no-clients');
                var wrapper = document.getElementById('logs-media-hunt-content-wrapper');
                if (noInst) noInst.style.display = (state === 'no-instances') ? '' : 'none';
                if (noIdx) noIdx.style.display = (state === 'no-indexers') ? '' : 'none';
                if (noCli) noCli.style.display = (state === 'no-clients') ? '' : 'none';
                if (wrapper) wrapper.style.display = (state === 'ok') ? '' : 'none';
            });
            var logAppSelect2 = document.getElementById('logAppSelect');
            if (logAppSelect2) logAppSelect2.value = 'media_hunt';
            if (window.LogsModule) window.LogsModule.currentLogApp = 'media_hunt';
            if (window.LogsModule && typeof window.LogsModule.setAppFilterContext === 'function') {
                window.LogsModule.setAppFilterContext('media-hunt');
            }
            if (window.LogsModule && typeof window.LogsModule.updateDebugLevelVisibility === 'function') {
                window.LogsModule.updateDebugLevelVisibility();
            }
            if (window.LogsModule) {
                try {
                    if (window.LogsModule.initialized) { window.LogsModule.connectToLogs(); }
                    else { window.LogsModule.init(); }
                } catch (error) { console.error('[huntarrUI] Error during LogsModule calls:', error); }
            }
        } else if (section === 'media-hunt-collection' && document.getElementById('mediaHuntSection')) {
            if (document.getElementById('tvHuntActivitySection')) {
                document.getElementById('tvHuntActivitySection').classList.remove('active');
                document.getElementById('tvHuntActivitySection').style.display = 'none';
            }
            if (document.getElementById('activitySection')) {
                document.getElementById('activitySection').classList.remove('active');
                document.getElementById('activitySection').style.display = 'none';
            }
            document.getElementById('mediaHuntSection').classList.add('active');
            document.getElementById('mediaHuntSection').style.display = 'block';
            ['mediaHuntInstanceManagementSection', 'mediaHuntInstanceEditorSection', 'tvHuntSettingsCustomFormatsSection', 'mediaHuntProfilesSection', 'tvHuntSettingsIndexersSection', 'tvHuntSettingsClientsSection', 'tvHuntSettingsRootFoldersSection', 'mediaHuntSettingsImportMediaSection', 'tvHuntSettingsTVManagementSection', 'tvManagementSection', 'tvHuntSettingsImportListsSection'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.classList.remove('active'); el.style.display = 'none'; }
            });
            if (document.getElementById('mediaHuntCalendarSection')) {
                document.getElementById('mediaHuntCalendarSection').classList.remove('active');
                document.getElementById('mediaHuntCalendarSection').style.display = 'none';
            }
            var mainContent = document.querySelector('#mediaHuntSection .requestarr-content');
            var collectionView = document.getElementById('media-hunt-collection-view');
            var wizardView = document.getElementById('media-hunt-setup-wizard-view');
            if (mainContent) mainContent.style.display = 'none';
            if (collectionView) collectionView.style.display = 'none';
            if (wizardView) wizardView.style.display = 'none';
            newTitle = 'Media Hunt';
            this.currentSection = 'media-hunt-collection';
            if (this._pendingMediaHuntSidebar === 'tv') { this.showTVHuntSidebar(); }
            else if (this._pendingMediaHuntSidebar === 'movie') { this.showMovieHuntSidebar(); }
            else { this.showMovieHuntSidebar(); }
            this._pendingMediaHuntSidebar = undefined;
            if (typeof setActiveNavItem === 'function') setActiveNavItem();

            // ── Setup Wizard gate — show wizard if setup is incomplete ──
            var _hash = window.location.hash || '';
            if (window.SetupWizard && typeof window.SetupWizard.check === 'function') {
                window.SetupWizard.check(function(needsWizard) {
                    if (needsWizard) {
                        window.SetupWizard.show();
                    } else {
                        if (wizardView) wizardView.style.display = 'none';
                        if (collectionView) collectionView.style.display = 'block';
                        if (!/\/tv\/\d+$/.test(_hash)) {
                            if (window.TVHuntCollection && typeof window.TVHuntCollection.showMainView === 'function') {
                                window.TVHuntCollection.showMainView();
                            }
                        }
                        if (window.MediaHuntCollection && typeof window.MediaHuntCollection.init === 'function') {
                            window.MediaHuntCollection.init();
                        }
                    }
                });
            } else {
                // Fallback if SetupWizard not loaded
                if (collectionView) collectionView.style.display = 'block';
                if (window.MediaHuntCollection && typeof window.MediaHuntCollection.init === 'function') {
                    window.MediaHuntCollection.init();
                }
            }
        } else if ((section === 'media-hunt-settings' || section === 'media-hunt-instances') && document.getElementById('mediaHuntInstanceManagementSection')) {
            if (document.getElementById('tvHuntActivitySection')) {
                document.getElementById('tvHuntActivitySection').classList.remove('active');
                document.getElementById('tvHuntActivitySection').style.display = 'none';
            }
            if (document.getElementById('media-hunt-settings-default-section')) {
                document.getElementById('media-hunt-settings-default-section').classList.remove('active');
                document.getElementById('media-hunt-settings-default-section').style.display = 'none';
            }
            document.getElementById('mediaHuntInstanceManagementSection').classList.add('active');
            document.getElementById('mediaHuntInstanceManagementSection').style.display = 'block';
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = section === 'media-hunt-instances' ? 'Instances' : 'Media Hunt Settings';
            this.currentSection = section;
            this.showMovieHuntSidebar();
            this._pendingMediaHuntSidebar = undefined;
            if (typeof setActiveNavItem === 'function') setActiveNavItem();
            if (window.MediaHuntInstanceManagement && typeof window.MediaHuntInstanceManagement.init === 'function') {
                window.MediaHuntInstanceManagement.init();
            }
        } else if (section === 'tv-hunt-settings-custom-formats' && document.getElementById('settingsCustomFormatsSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            document.getElementById('settingsCustomFormatsSection').classList.add('active');
            document.getElementById('settingsCustomFormatsSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsCustomFormatsNav')) document.getElementById('tvHuntSettingsCustomFormatsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'Custom Formats';
            this.currentSection = 'tv-hunt-settings-custom-formats';
            this.showTVHuntSidebar();
            if (window.CustomFormats && typeof window.CustomFormats.initOrRefresh === 'function') {
                window.CustomFormats.initOrRefresh('tv');
            }
        } else if (section === 'tv-hunt-settings-profiles' && document.getElementById('mediaHuntProfilesSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            document.getElementById('mediaHuntProfilesSection').classList.add('active');
            document.getElementById('mediaHuntProfilesSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsProfilesNav')) document.getElementById('tvHuntSettingsProfilesNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'Profiles';
            this.currentSection = 'tv-hunt-settings-profiles';
            this.showTVHuntSidebar();
            if (window.MediaHuntProfiles && typeof window.MediaHuntProfiles.initOrRefresh === 'function') {
                window.MediaHuntProfiles.initOrRefresh('tv');
            }
        } else if (section === 'tv-hunt-settings-indexers' && document.getElementById('indexer-hunt-section')) {
            /* TV Hunt Indexers merged into Index Master; redirect to Index Master */
            this.switchSection('indexer-hunt');
            return;
        } else if (section === 'tv-hunt-settings-clients' && document.getElementById('tvHuntSettingsClientsSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            document.getElementById('tvHuntSettingsClientsSection').classList.add('active');
            document.getElementById('tvHuntSettingsClientsSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsClientsNav')) document.getElementById('tvHuntSettingsClientsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'TV Hunt Clients';
            this.currentSection = 'tv-hunt-settings-clients';
            this.showTVHuntSidebar();
            if (window.TVHuntInstanceDropdown && window.TVHuntInstanceDropdown.attach) {
                window.TVHuntInstanceDropdown.attach('tv-hunt-settings-clients-instance-select', function() {
                    if (window.TVHuntSettingsForms && typeof window.TVHuntSettingsForms.refreshClientsList === 'function') {
                        window.TVHuntSettingsForms.refreshClientsList();
                    }
                });
            }
            if (window.TVHuntSettingsForms && typeof window.TVHuntSettingsForms.refreshClientsList === 'function') {
                window.TVHuntSettingsForms.refreshClientsList();
            }
        } else if (section === 'tv-hunt-settings-root-folders' && document.getElementById('settingsRootFoldersSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            document.getElementById('settingsRootFoldersSection').classList.add('active');
            document.getElementById('settingsRootFoldersSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsRootFoldersNav')) document.getElementById('tvHuntSettingsRootFoldersNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'Root Folders';
            this.currentSection = 'tv-hunt-settings-root-folders';
            this.showTVHuntSidebar();
            if (window.RootFolders && typeof window.RootFolders.initOrRefresh === 'function') {
                window.RootFolders.initOrRefresh('tv');
            }
        } else if (section === 'tv-hunt-settings-tv-management' && document.getElementById('tvManagementSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            document.getElementById('tvManagementSection').classList.add('active');
            document.getElementById('tvManagementSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsTVManagementNav')) document.getElementById('tvHuntSettingsTVManagementNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            if (document.getElementById('movieManagementSection')) { document.getElementById('movieManagementSection').classList.remove('active'); document.getElementById('movieManagementSection').style.display = 'none'; }
            newTitle = 'Media Management';
            this.currentSection = 'tv-hunt-settings-tv-management';
            this.showTVHuntSidebar();
            if (window.TVManagement && typeof window.TVManagement.initOrRefresh === 'function') {
                window.TVManagement.initOrRefresh();
            }
        } else if (section === 'tv-hunt-settings-import-lists' && document.getElementById('settingsImportListsSection')) {
            if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            document.getElementById('settingsImportListsSection').classList.add('active');
            document.getElementById('settingsImportListsSection').style.display = 'block';
            if (document.getElementById('tvHuntSettingsImportListsNav')) document.getElementById('tvHuntSettingsImportListsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntInstanceEditorSection')) { document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active'); document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
            if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
            newTitle = 'Import Lists';
            this.currentSection = 'tv-hunt-settings-import-lists';
            this.showTVHuntSidebar();
            if (window.ImportLists && typeof window.ImportLists.initOrRefresh === 'function') {
                window.ImportLists.initOrRefresh('tv');
            }
        } else if (section && section.startsWith('tv-hunt-activity') && document.getElementById('tvHuntActivitySection')) {
            // TV Hunt Activity - dedicated section (History, Blocklist unique to TV Hunt; separate from Movie Hunt)
            // Redirect queue to history (queue is now in NZB Hunt)
            if (section === 'tv-hunt-activity-queue') {
                section = 'tv-hunt-activity-history';
                history.replaceState(null, '', './#tv-hunt-activity-history');
            }
            if (document.getElementById('activitySection')) {
                document.getElementById('activitySection').classList.remove('active');
                document.getElementById('activitySection').style.display = 'none';
            }
            document.getElementById('tvHuntActivitySection').classList.add('active');
            document.getElementById('tvHuntActivitySection').style.display = 'block';
            // Update sidebar nav links so History/Blocklist stay in TV Hunt Activity
            var hNav = document.getElementById('movieHuntActivityHistoryNav');
            var bNav = document.getElementById('movieHuntActivityBlocklistNav');
            if (hNav) hNav.setAttribute('href', './#tv-hunt-activity-history');
            if (bNav) bNav.setAttribute('href', './#tv-hunt-activity-blocklist');
            // Hide all TV Hunt settings/main sections
            ['mediaHuntSection', 'mediaHuntInstanceManagementSection', 'mediaHuntInstanceEditorSection', 'tvHuntSettingsCustomFormatsSection', 'mediaHuntProfilesSection', 'tvHuntSettingsIndexersSection', 'tvHuntSettingsClientsSection', 'tvHuntSettingsRootFoldersSection', 'mediaHuntSettingsImportMediaSection', 'tvHuntSettingsTVManagementSection', 'tvManagementSection', 'tvHuntSettingsImportListsSection'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.classList.remove('active'); el.style.display = 'none'; }
            });
            var view = section === 'tv-hunt-activity-history' ? 'history' : 'blocklist';
            newTitle = 'TV Hunt ' + view.charAt(0).toUpperCase() + view.slice(1);
            this.currentSection = section;
            this.showTVHuntSidebar();
            if (window.TVHuntActivityModule && typeof window.TVHuntActivityModule.init === 'function') {
                window.TVHuntActivityModule.init(view);
            }
        } else if (section === 'media-hunt-calendar' && document.getElementById('mediaHuntCalendarSection')) {
            if (document.getElementById('mediaHuntSection')) {
                document.getElementById('mediaHuntSection').classList.remove('active');
                document.getElementById('mediaHuntSection').style.display = 'none';
            }
            if (document.getElementById('activitySection')) {
                document.getElementById('activitySection').classList.remove('active');
                document.getElementById('activitySection').style.display = 'none';
            }
            if (document.getElementById('tvHuntActivitySection')) {
                document.getElementById('tvHuntActivitySection').classList.remove('active');
                document.getElementById('tvHuntActivitySection').style.display = 'none';
            }
            document.getElementById('mediaHuntCalendarSection').classList.add('active');
            document.getElementById('mediaHuntCalendarSection').style.display = 'block';
            if (document.getElementById('movieHuntCalendarNav')) document.getElementById('movieHuntCalendarNav').classList.add('active');
            newTitle = 'Calendar';
            this.currentSection = 'media-hunt-calendar';
            this.showMovieHuntSidebar();
            var calMode = this._pendingMediaHuntCalendarMode || 'movie';
            this._pendingMediaHuntCalendarMode = undefined;
            window._mediaHuntCalendarMode = calMode;
            if (window.MediaHuntCalendar && typeof window.MediaHuntCalendar.init === 'function') {
                window.MediaHuntCalendar.init();
            }
        } else if ((section === 'activity-queue' || section === 'activity-history' || section === 'activity-blocklist' || section === 'activity-logs') && document.getElementById('activitySection')) {
            if (document.getElementById('tvHuntActivitySection')) {
                document.getElementById('tvHuntActivitySection').classList.remove('active');
                document.getElementById('tvHuntActivitySection').style.display = 'none';
            }
            document.getElementById('activitySection').classList.add('active');
            document.getElementById('activitySection').style.display = 'block';
            // Restore sidebar nav links to Movie Hunt Activity
            var qNav = document.getElementById('movieHuntActivityQueueNav');
            var hNav = document.getElementById('movieHuntActivityHistoryNav');
            var bNav = document.getElementById('movieHuntActivityBlocklistNav');
            if (qNav) qNav.setAttribute('href', './#activity-queue');
            if (hNav) hNav.setAttribute('href', './#activity-history');
            if (bNav) bNav.setAttribute('href', './#activity-blocklist');
            if (document.getElementById('mediaHuntSection')) {
                document.getElementById('mediaHuntSection').classList.remove('active');
                document.getElementById('mediaHuntSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntCalendarSection')) {
                document.getElementById('mediaHuntCalendarSection').classList.remove('active');
                document.getElementById('mediaHuntCalendarSection').style.display = 'none';
            }
            var view = section === 'activity-queue' ? 'queue' : section === 'activity-history' ? 'history' : section === 'activity-blocklist' ? 'blocklist' : 'logs';
            newTitle = section === 'activity-queue' ? 'Activity – Queue' : section === 'activity-history' ? 'Activity – History' : section === 'activity-blocklist' ? 'Activity – Blocklist' : 'Activity – Logs';
            this.currentSection = section;
            this.showMovieHuntSidebar();
            if (window.ActivityModule && typeof window.ActivityModule.init === 'function') {
                window.ActivityModule.init(view);
            }
        } else if ((section === 'movie-hunt-instance-editor' || section === 'tv-hunt-instance-editor') && document.getElementById('mediaHuntInstanceEditorSection')) {
            window._mediaHuntInstanceEditorMode = section === 'tv-hunt-instance-editor' ? 'tv' : 'movie';
            if (section === 'tv-hunt-instance-editor') {
                if (document.getElementById('tvHuntActivitySection')) { document.getElementById('tvHuntActivitySection').classList.remove('active'); document.getElementById('tvHuntActivitySection').style.display = 'none'; }
                if (document.getElementById('mediaHuntInstanceManagementSection')) { document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active'); document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
                if (document.getElementById('mediaHuntProfilesSection')) { document.getElementById('mediaHuntProfilesSection').classList.remove('active'); document.getElementById('mediaHuntProfilesSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsIndexersSection')) { document.getElementById('tvHuntSettingsIndexersSection').classList.remove('active'); document.getElementById('tvHuntSettingsIndexersSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsClientsSection')) { document.getElementById('tvHuntSettingsClientsSection').classList.remove('active'); document.getElementById('tvHuntSettingsClientsSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
                if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
                if (document.getElementById('mediaHuntSection')) { document.getElementById('mediaHuntSection').classList.remove('active'); document.getElementById('mediaHuntSection').style.display = 'none'; }
                if (document.getElementById('mediaHuntCalendarSection')) { document.getElementById('mediaHuntCalendarSection').classList.remove('active'); document.getElementById('mediaHuntCalendarSection').style.display = 'none'; }
                newTitle = 'TV Hunt Instance Editor';
                this.currentSection = 'tv-hunt-instance-editor';
                this.showTVHuntSidebar();
            } else {
                if (document.getElementById('media-hunt-settings-default-section')) {
                    document.getElementById('media-hunt-settings-default-section').classList.remove('active');
                    document.getElementById('media-hunt-settings-default-section').style.display = 'none';
                }
                if (document.getElementById('mediaHuntInstanceManagementSection')) {
                    document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                    document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
                }
                newTitle = 'Movie Hunt';
                this.currentSection = 'movie-hunt-instance-editor';
                this.showMovieHuntSidebar();
            }
            document.getElementById('mediaHuntInstanceEditorSection').classList.add('active');
            document.getElementById('mediaHuntInstanceEditorSection').style.display = 'block';
        } else if (section === 'requestarr' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrNav')) document.getElementById('requestarrNav').classList.add('active');
            newTitle = 'Discover';
            this.currentSection = 'requestarr';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show discover view by default
            this.runWhenRequestarrReady('discover', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('discover');
                }
            });
        } else if (section === 'requestarr-discover' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrDiscoverNav')) document.getElementById('requestarrDiscoverNav').classList.add('active');
            newTitle = 'Discover';
            this.currentSection = 'requestarr-discover';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show discover view
            this.runWhenRequestarrReady('discover', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('discover');
                }
            });
        } else if (section === 'requestarr-movies' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            
            // Check if we came from Movie Search in Movie Hunt sidebar
            var fromMovieSearch = false;
            try { fromMovieSearch = sessionStorage.getItem('requestarr-from-movie-search'); sessionStorage.removeItem('requestarr-from-movie-search'); } catch (err) {}
            
            if (fromMovieSearch) {
                // Keep Movie Hunt sidebar group active with Movie Search highlighted
                this.showMovieHuntSidebar();
                // Clear all Media Hunt nav items first
                var movieHuntNavItems = document.querySelectorAll('#sidebar-group-media-hunt .nav-item');
                if (movieHuntNavItems.length) movieHuntNavItems.forEach(function(el) { el.classList.remove('active'); });
                // Then highlight only Movie Search
                if (document.getElementById('movieHuntMovieSearchNav')) document.getElementById('movieHuntMovieSearchNav').classList.add('active');
            } else {
                // Normal navigation: show Requestarr sidebar
                if (document.getElementById('requestarrMoviesNav')) document.getElementById('requestarrMoviesNav').classList.add('active');
                this.showRequestarrSidebar();
            }
            
            newTitle = 'Movies';
            this.currentSection = 'requestarr-movies';
            
            // Force movies view layout immediately
            const viewIds = [
                'requestarr-discover-view',
                'requestarr-movies-view',
                'requestarr-tv-view',
                'requestarr-hidden-view',
                'requestarr-smarthunt-view',
                'requestarr-settings-view',
                'requestarr-smarthunt-settings-view',
                'requestarr-users-view',
                'requestarr-bundles-view',
                'requestarr-requests-view',
                'requestarr-global-blacklist-view'
            ];
            viewIds.forEach((viewId) => {
                const view = document.getElementById(viewId);
                if (!view) return;
                view.classList.remove('active');
                view.style.display = 'none';
            });
            const moviesView = document.getElementById('requestarr-movies-view');
            if (moviesView) {
                moviesView.classList.add('active');
                moviesView.style.display = 'block';
            }

            // Show movies view
            this.runWhenRequestarrReady('movies', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('movies');
                }
            });
        } else if (section === 'requestarr-tv' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrTVNav')) document.getElementById('requestarrTVNav').classList.add('active');
            newTitle = 'TV Shows';
            this.currentSection = 'requestarr-tv';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show TV view
            this.runWhenRequestarrReady('tv', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('tv');
                }
            });
        } else if ((section === 'requestarr-hidden' || section === 'requestarr-personal-blacklist') && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrPersonalBlacklistNav')) document.getElementById('requestarrPersonalBlacklistNav').classList.add('active');
            newTitle = 'Personal Blacklist';
            this.currentSection = 'requestarr-personal-blacklist';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show hidden view
            this.runWhenRequestarrReady('hidden', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('hidden');
                }
            });
        } else if ((section === 'requestarr-filters' || section === 'requestarr-settings') && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrSettingsNav')) document.getElementById('requestarrSettingsNav').classList.add('active');
            newTitle = 'Filters';
            this.currentSection = 'requestarr-filters';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show settings view
            this.runWhenRequestarrReady('settings', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('settings');
                }
            });
        } else if (section === 'requestarr-smarthunt' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrSmartHuntNav')) document.getElementById('requestarrSmartHuntNav').classList.add('active');
            newTitle = 'Smart Hunt';
            this.currentSection = 'requestarr-smarthunt';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show Smart Hunt view
            this.runWhenRequestarrReady('smarthunt', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('smarthunt');
                }
            });
        } else if (section === 'requestarr-smarthunt-settings' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrSmartHuntSettingsNav')) document.getElementById('requestarrSmartHuntSettingsNav').classList.add('active');
            newTitle = 'Smart Hunt';
            this.currentSection = 'requestarr-smarthunt-settings';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show Smart Hunt settings view
            this.runWhenRequestarrReady('smarthunt-settings', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('smarthunt-settings');
                }
            });
        } else if (section === 'requestarr-users' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrUsersNav')) document.getElementById('requestarrUsersNav').classList.add('active');
            newTitle = 'Users';
            this.currentSection = 'requestarr-users';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show users view
            this.runWhenRequestarrReady('users', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('users');
                }
            });
        } else if (section === 'requestarr-bundles' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrBundlesNav')) document.getElementById('requestarrBundlesNav').classList.add('active');
            newTitle = 'Bundles';
            this.currentSection = 'requestarr-bundles';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show bundles view
            this.runWhenRequestarrReady('bundles', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('bundles');
                }
            });
        } else if (section === 'requestarr-requests' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrRequestsNav')) document.getElementById('requestarrRequestsNav').classList.add('active');
            newTitle = 'Requests';
            this.currentSection = 'requestarr-requests';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show requests view
            this.runWhenRequestarrReady('requests', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('requests');
                }
            });
        } else if (section === 'requestarr-global-blacklist' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrGlobalBlacklistNav')) document.getElementById('requestarrGlobalBlacklistNav').classList.add('active');
            newTitle = 'Global Blacklist';
            this.currentSection = 'requestarr-global-blacklist';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show global blacklist view
            this.runWhenRequestarrReady('global-blacklist', () => {
                if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
                    window.RequestarrDiscover.switchView('global-blacklist');
                }
            });
        } else if (section === 'apps') {
            console.log('[huntarrUI] Apps section requested - redirecting to Sonarr by default');
            // Instead of showing apps dashboard, redirect to Sonarr
            this.switchSection('sonarr');
            window.location.hash = '#sonarr';
            return;
        } else if (section === 'sonarr' && document.getElementById('sonarrSection')) {
            document.getElementById('sonarrSection').classList.add('active');
            document.getElementById('sonarrSection').style.display = 'block';
            if (document.getElementById('appsSonarrNav')) document.getElementById('appsSonarrNav').classList.add('active');
            newTitle = 'Sonarr';
            this.currentSection = 'sonarr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for sonarr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('sonarr');
            }
        } else if (section === 'radarr' && document.getElementById('radarrSection')) {
            document.getElementById('radarrSection').classList.add('active');
            document.getElementById('radarrSection').style.display = 'block';
            if (document.getElementById('appsRadarrNav')) document.getElementById('appsRadarrNav').classList.add('active');
            newTitle = 'Radarr';
            this.currentSection = 'radarr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for radarr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('radarr');
            }
        } else if (section === 'lidarr' && document.getElementById('lidarrSection')) {
            document.getElementById('lidarrSection').classList.add('active');
            document.getElementById('lidarrSection').style.display = 'block';
            if (document.getElementById('appsLidarrNav')) document.getElementById('appsLidarrNav').classList.add('active');
            newTitle = 'Lidarr';
            this.currentSection = 'lidarr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for lidarr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('lidarr');
            }
        } else if (section === 'readarr' && document.getElementById('readarrSection')) {
            document.getElementById('readarrSection').classList.add('active');
            document.getElementById('readarrSection').style.display = 'block';
            if (document.getElementById('appsReadarrNav')) document.getElementById('appsReadarrNav').classList.add('active');
            newTitle = 'Readarr';
            this.currentSection = 'readarr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for readarr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('readarr');
            }
        } else if (section === 'whisparr' && document.getElementById('whisparrSection')) {
            document.getElementById('whisparrSection').classList.add('active');
            document.getElementById('whisparrSection').style.display = 'block';
            if (document.getElementById('appsWhisparrNav')) document.getElementById('appsWhisparrNav').classList.add('active');
            newTitle = 'Whisparr V2';
            this.currentSection = 'whisparr';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for whisparr
            if (typeof appsModule !== 'undefined') {
                appsModule.init('whisparr');
            }
        } else if (section === 'eros' && document.getElementById('erosSection')) {
            document.getElementById('erosSection').classList.add('active');
            document.getElementById('erosSection').style.display = 'block';
            if (document.getElementById('appsErosNav')) document.getElementById('appsErosNav').classList.add('active');
            newTitle = 'Whisparr V3';
            this.currentSection = 'eros';
            
            // Switch to Apps sidebar
            this.showAppsSidebar();
            
            // Initialize app module for eros
            if (typeof appsModule !== 'undefined') {
                appsModule.init('eros');
            }
        } else if (section === 'swaparr' && document.getElementById('swaparrSection')) {
            document.getElementById('swaparrSection').classList.add('active');
            document.getElementById('swaparrSection').style.display = 'block';
            if (document.getElementById('appsSwaparrNav')) document.getElementById('appsSwaparrNav').classList.add('active');
            newTitle = 'Swaparr';
            this.currentSection = 'swaparr';
            
            // Show Apps sidebar (Swaparr lives under Apps)
            this.showAppsSidebar();
            
            // Initialize Swaparr section
            this.initializeSwaparr();
        } else if (section === 'settings' && document.getElementById('settingsSection')) {
            document.getElementById('settingsSection').classList.add('active');
            document.getElementById('settingsSection').style.display = 'block';
            newTitle = 'Settings';
            this.currentSection = 'settings';
            this.showSettingsSidebar();
            this.initializeSettings();
        } else if (section === 'settings-instance-management' && document.getElementById('mediaHuntInstanceManagementSection')) {
            document.getElementById('mediaHuntInstanceManagementSection').classList.add('active');
            document.getElementById('mediaHuntInstanceManagementSection').style.display = 'block';
            if (document.getElementById('media-hunt-settings-default-section')) {
                document.getElementById('media-hunt-settings-default-section').classList.remove('active');
                document.getElementById('media-hunt-settings-default-section').style.display = 'none';
            }
            if (document.getElementById('mediaHuntInstanceEditorSection')) {
                document.getElementById('mediaHuntInstanceEditorSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceEditorSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            if (document.getElementById('settingsIndexersSection')) {
                document.getElementById('settingsIndexersSection').classList.remove('active');
                document.getElementById('settingsIndexersSection').style.display = 'none';
            }
            if (document.getElementById('settingsClientsSection')) {
                document.getElementById('settingsClientsSection').classList.remove('active');
                document.getElementById('settingsClientsSection').style.display = 'none';
            }
            if (document.getElementById('settingsImportListsSection')) {
                document.getElementById('settingsImportListsSection').classList.remove('active');
                document.getElementById('settingsImportListsSection').style.display = 'none';
            }
            if (document.getElementById('settingsRootFoldersSection')) {
                document.getElementById('settingsRootFoldersSection').classList.remove('active');
                document.getElementById('settingsRootFoldersSection').style.display = 'none';
            }
            newTitle = 'Instances';
            this.currentSection = 'settings-instance-management';
            this.showMovieHuntSidebar();
            window._mediaHuntInstanceManagementMode = 'movie';
            if (window.MediaHuntInstanceManagement && typeof window.MediaHuntInstanceManagement.init === 'function') {
                window.MediaHuntInstanceManagement.init();
            }
        } else if (section === 'settings-media-management' && document.getElementById('movieManagementSection')) {
            if (document.getElementById('tvHuntSettingsTVManagementSection')) { document.getElementById('tvHuntSettingsTVManagementSection').classList.remove('active'); document.getElementById('tvHuntSettingsTVManagementSection').style.display = 'none'; }
            if (document.getElementById('tvManagementSection')) { document.getElementById('tvManagementSection').classList.remove('active'); document.getElementById('tvManagementSection').style.display = 'none'; }
            document.getElementById('movieManagementSection').classList.add('active');
            document.getElementById('movieManagementSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsMovieManagementNav')) document.getElementById('movieHuntSettingsMovieManagementNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            if (document.getElementById('settingsIndexersSection')) {
                document.getElementById('settingsIndexersSection').classList.remove('active');
                document.getElementById('settingsIndexersSection').style.display = 'none';
            }
            if (document.getElementById('settingsClientsSection')) {
                document.getElementById('settingsClientsSection').classList.remove('active');
                document.getElementById('settingsClientsSection').style.display = 'none';
            }
            if (document.getElementById('settingsImportListsSection')) {
                document.getElementById('settingsImportListsSection').classList.remove('active');
                document.getElementById('settingsImportListsSection').style.display = 'none';
            }
            if (document.getElementById('settingsRootFoldersSection')) {
                document.getElementById('settingsRootFoldersSection').classList.remove('active');
                document.getElementById('settingsRootFoldersSection').style.display = 'none';
            }
            newTitle = 'Media Management';
            this.currentSection = 'settings-media-management';
            this.showMovieHuntSidebar();
            if (window.MovieManagement && typeof window.MovieManagement.initOrRefresh === 'function') {
                window.MovieManagement.initOrRefresh();
            }
        } else if (section === 'settings-profiles' && document.getElementById('mediaHuntProfilesSection')) {
            document.getElementById('mediaHuntProfilesSection').classList.add('active');
            document.getElementById('mediaHuntProfilesSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsProfilesNav')) document.getElementById('movieHuntSettingsProfilesNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            newTitle = 'Profiles';
            this.currentSection = 'settings-profiles';
            this.showMovieHuntSidebar();
            if (window.MediaHuntProfiles && typeof window.MediaHuntProfiles.initOrRefresh === 'function') {
                window.MediaHuntProfiles.initOrRefresh('movie');
            }
        } else if (section === 'settings-sizes' && document.getElementById('settingsSizesSection')) {
            document.getElementById('settingsSizesSection').classList.add('active');
            document.getElementById('settingsSizesSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsSizesNav')) document.getElementById('movieHuntSettingsSizesNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            if (document.getElementById('settingsIndexersSection')) {
                document.getElementById('settingsIndexersSection').classList.remove('active');
                document.getElementById('settingsIndexersSection').style.display = 'none';
            }
            if (document.getElementById('settingsClientsSection')) {
                document.getElementById('settingsClientsSection').classList.remove('active');
                document.getElementById('settingsClientsSection').style.display = 'none';
            }
            if (document.getElementById('settingsImportListsSection')) {
                document.getElementById('settingsImportListsSection').classList.remove('active');
                document.getElementById('settingsImportListsSection').style.display = 'none';
            }
            if (document.getElementById('settingsRootFoldersSection')) {
                document.getElementById('settingsRootFoldersSection').classList.remove('active');
                document.getElementById('settingsRootFoldersSection').style.display = 'none';
            }
            var _sizesPreferMode = this._pendingSizesMode || 'movie';
            this._pendingSizesMode = null;
            newTitle = 'Sizes';
            this.currentSection = 'settings-sizes';
            if (_sizesPreferMode === 'tv') {
                this.showTVHuntSidebar();
                if (document.getElementById('tvHuntSettingsSizesNav')) document.getElementById('tvHuntSettingsSizesNav').classList.add('active');
            } else {
                this.showMovieHuntSidebar();
            }
            if (window.SizesModule && typeof window.SizesModule.initOrRefresh === 'function') {
                window.SizesModule.initOrRefresh(_sizesPreferMode);
            }
        } else if (section === 'settings-custom-formats' && document.getElementById('settingsCustomFormatsSection')) {
            if (document.getElementById('tvHuntSettingsCustomFormatsSection')) { document.getElementById('tvHuntSettingsCustomFormatsSection').classList.remove('active'); document.getElementById('tvHuntSettingsCustomFormatsSection').style.display = 'none'; }
            document.getElementById('settingsCustomFormatsSection').classList.add('active');
            document.getElementById('settingsCustomFormatsSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsCustomFormatsNav')) document.getElementById('movieHuntSettingsCustomFormatsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('profileEditorSection')) {
                document.getElementById('profileEditorSection').classList.remove('active');
                document.getElementById('profileEditorSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            newTitle = 'Custom Formats';
            this.currentSection = 'settings-custom-formats';
            this.showMovieHuntSidebar();
            if (window.CustomFormats && typeof window.CustomFormats.initOrRefresh === 'function') {
                window.CustomFormats.initOrRefresh('movie');
            }
        } else if (section === 'profile-editor' && document.getElementById('profileEditorSection')) {
            document.getElementById('profileEditorSection').classList.add('active');
            document.getElementById('profileEditorSection').style.display = 'block';
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            if (document.getElementById('mediaHuntProfilesSection')) {
                document.getElementById('mediaHuntProfilesSection').classList.remove('active');
                document.getElementById('mediaHuntProfilesSection').style.display = 'none';
            }
            newTitle = 'Profile Editor';
            this.currentSection = 'profile-editor';
            if (window._profileEditorTVHunt) {
                window._profileEditorTVHunt = false;
                this.showTVHuntSidebar();
                if (document.getElementById('tvHuntSettingsProfilesNav')) document.getElementById('tvHuntSettingsProfilesNav').classList.add('active');
            } else {
                this.showMovieHuntSidebar();
                if (document.getElementById('movieHuntSettingsProfilesNav')) document.getElementById('movieHuntSettingsProfilesNav').classList.add('active');
            }
        } else if (section === 'settings-indexers' && document.getElementById('indexer-hunt-section')) {
            /* Indexers merged into Index Master; redirect to Index Master */
            if (window.location.hash !== '#indexer-hunt') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#indexer-hunt');
            }
            this.switchSection('indexer-hunt');
            return;
        } else if (section === 'settings-clients' && document.getElementById('settingsClientsSection')) {
            document.getElementById('settingsClientsSection').classList.add('active');
            document.getElementById('settingsClientsSection').style.display = 'block';
            if (document.getElementById('movieHuntClientsMainNav')) document.getElementById('movieHuntClientsMainNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            newTitle = 'Clients';
            this.currentSection = 'settings-clients';
            this.showMovieHuntSidebar();
            if (window.SettingsForms && typeof window.SettingsForms.refreshClientsList === 'function') {
                window.SettingsForms.refreshClientsList();
            }
        } else if (section === 'settings-import-lists' && document.getElementById('settingsImportListsSection')) {
            if (document.getElementById('tvHuntSettingsImportListsSection')) { document.getElementById('tvHuntSettingsImportListsSection').classList.remove('active'); document.getElementById('tvHuntSettingsImportListsSection').style.display = 'none'; }
            document.getElementById('settingsImportListsSection').classList.add('active');
            document.getElementById('settingsImportListsSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsImportListsNav')) document.getElementById('movieHuntSettingsImportListsNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            newTitle = 'Import Lists';
            this.currentSection = 'settings-import-lists';
            this.showMovieHuntSidebar();
            if (window.ImportLists && typeof window.ImportLists.initOrRefresh === 'function') {
                window.ImportLists.initOrRefresh('movie');
            }
        } else if (section === 'settings-import-media' && document.getElementById('mediaHuntSettingsImportMediaSection')) {
            document.getElementById('mediaHuntSettingsImportMediaSection').classList.add('active');
            document.getElementById('mediaHuntSettingsImportMediaSection').style.display = 'block';
            if (document.getElementById('movieHuntImportMediaNav')) document.getElementById('movieHuntImportMediaNav').classList.add('active');
            newTitle = 'Import Media';
            this.currentSection = 'settings-import-media';
            this.showMovieHuntSidebar();
            if (window.MediaHuntImportMedia && typeof window.MediaHuntImportMedia.init === 'function') {
                window.MediaHuntImportMedia.init();
            }
        } else if (section === 'settings-root-folders' && document.getElementById('settingsRootFoldersSection')) {
            if (document.getElementById('tvHuntSettingsRootFoldersSection')) { document.getElementById('tvHuntSettingsRootFoldersSection').classList.remove('active'); document.getElementById('tvHuntSettingsRootFoldersSection').style.display = 'none'; }
            document.getElementById('settingsRootFoldersSection').classList.add('active');
            document.getElementById('settingsRootFoldersSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsRootFoldersNav')) document.getElementById('movieHuntSettingsRootFoldersNav').classList.add('active');
            if (document.getElementById('mediaHuntInstanceManagementSection')) {
                document.getElementById('mediaHuntInstanceManagementSection').classList.remove('active');
                document.getElementById('mediaHuntInstanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            newTitle = 'Root Folders';
            this.currentSection = 'settings-root-folders';
            this.showMovieHuntSidebar();
            if (window.RootFolders && typeof window.RootFolders.initOrRefresh === 'function') {
                window.RootFolders.initOrRefresh('movie');
            }
        } else if (section === 'settings-logs' && document.getElementById('settingsLogsSection')) {
            document.getElementById('settingsLogsSection').classList.add('active');
            document.getElementById('settingsLogsSection').style.display = 'block';
            newTitle = 'Log Settings';
            this.currentSection = 'settings-logs';
            this.showSettingsSidebar();
            this.initializeLogsSettings();
        } else if (section === 'scheduling' && document.getElementById('schedulingSection')) {
            document.getElementById('schedulingSection').classList.add('active');
            document.getElementById('schedulingSection').style.display = 'block';
            newTitle = 'Scheduling';
            this.currentSection = 'scheduling';
            this.showSettingsSidebar();
            if (typeof window.refreshSchedulingInstances === 'function') {
                window.refreshSchedulingInstances();
            }
        } else if (section === 'notifications' && document.getElementById('notificationsSection')) {
            document.getElementById('notificationsSection').classList.add('active');
            document.getElementById('notificationsSection').style.display = 'block';
            newTitle = 'Notifications';
            this.currentSection = 'notifications';
            this.showSettingsSidebar();
            this.initializeNotifications();
        } else if (section === 'backup-restore' && document.getElementById('backupRestoreSection')) {
            document.getElementById('backupRestoreSection').classList.add('active');
            document.getElementById('backupRestoreSection').style.display = 'block';
            newTitle = 'Backup / Restore';
            this.currentSection = 'backup-restore';
            this.showSettingsSidebar();
            this.initializeBackupRestore();
        } else if (section === 'prowlarr' && document.getElementById('prowlarrSection')) {
            document.getElementById('prowlarrSection').classList.add('active');
            document.getElementById('prowlarrSection').style.display = 'block';
            if (document.getElementById('appsProwlarrNav')) document.getElementById('appsProwlarrNav').classList.add('active');
            newTitle = 'Prowlarr';
            this.currentSection = 'prowlarr';
            
            // Switch to Apps sidebar for prowlarr
            this.showAppsSidebar();
            
            // Initialize prowlarr settings if not already done
            this.initializeProwlarr();
        } else if (section === 'user' && document.getElementById('userSection')) {
            document.getElementById('userSection').classList.add('active');
            document.getElementById('userSection').style.display = 'block';
            newTitle = 'User';
            this.currentSection = 'user';
            this.showSettingsSidebar();
            this.initializeUser();
        } else if (section === 'instance-editor' && document.getElementById('instanceEditorSection')) {
            document.getElementById('instanceEditorSection').classList.add('active');
            document.getElementById('instanceEditorSection').style.display = 'block';
            this.currentSection = 'instance-editor';
            // Indexer/Client editor use Movie Hunt sidebar; app instance editor stays "Instance Editor"
            if (window.SettingsForms && window.SettingsForms._currentEditing && window.SettingsForms._currentEditing.appType === 'indexer') {
                var inst = window.SettingsForms._currentEditing.originalInstance || {};
                var preset = (inst.preset || 'manual').toString().toLowerCase().trim();
                newTitle = (window.SettingsForms.getIndexerPresetLabel && window.SettingsForms.getIndexerPresetLabel(preset)) ? (window.SettingsForms.getIndexerPresetLabel(preset) + ' Indexer Editor') : 'Indexer Editor';
                this.showMovieHuntSidebar();
                this._highlightMovieHuntNavForEditor('indexer');
            } else if (window.SettingsForms && window.SettingsForms._currentEditing && window.SettingsForms._currentEditing.appType === 'client') {
                var ct = (window.SettingsForms._currentEditing.originalInstance && window.SettingsForms._currentEditing.originalInstance.type) ? String(window.SettingsForms._currentEditing.originalInstance.type).toLowerCase() : 'nzbget';
                newTitle = (ct === 'nzbhunt' ? 'NZB Hunt (Built-in)' : ct === 'sabnzbd' ? 'SABnzbd' : ct === 'nzbget' ? 'NZBGet' : ct) + ' Connection Settings';
                this.showMovieHuntSidebar();
                this._highlightMovieHuntNavForEditor('client');
            } else {
                var appName = 'Instance Editor';
                if (window.SettingsForms && window.SettingsForms._currentEditing && window.SettingsForms._currentEditing.appType) {
                    var appType = window.SettingsForms._currentEditing.appType;
                    appName = appType.charAt(0).toUpperCase() + appType.slice(1);
                }
                newTitle = appName;
                this.showAppsSidebar();
            }
        } else {
            // Default to home if section is unknown or element missing
            if (this.elements.homeSection) {
                this.elements.homeSection.classList.add('active');
                this.elements.homeSection.style.display = 'block';
            }
            if (this.elements.homeNav) this.elements.homeNav.classList.add('active');
            newTitle = 'Home';
            this.currentSection = 'home';
            
            // Show main sidebar
            this.showMainSidebar();
        }

        // Disconnect logs when switching away from logs section
        if (this.currentSection !== 'logs' && window.LogsModule) {
            window.LogsModule.disconnectAllEventSources();
        }

        // Update the page title
        const pageTitleElement = document.getElementById('currentPageTitle');
        if (pageTitleElement) {
            pageTitleElement.textContent = newTitle;
            // Also update mobile page title
            if (typeof window.updateMobilePageTitle === 'function') {
                window.updateMobilePageTitle(newTitle);
            }
        } else {
            console.warn("[huntarrUI] currentPageTitle element not found during section switch.");
        }
    },

});
