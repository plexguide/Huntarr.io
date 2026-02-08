/**
 * Huntarr - Core Application Orchestrator
 * Main entry point for the Huntarr UI.
 * Coordinates between modular components and handles global application state.
 */

let huntarrUI = {
    // Current state
    currentSection: 'home', // Default section
    currentHistoryApp: 'all', // Default history app
    currentLogApp: 'all', // Default log app for compatibility
    autoScroll: true,
    eventSources: {}, // Event sources for compatibility
    isLoadingStats: false, // Flag to prevent multiple simultaneous stats requests
    configuredApps: {
        sonarr: false,
        radarr: false,
        lidarr: false,
        readarr: false, // Added readarr
        whisparr: false, // Added whisparr
        eros: false, // Added eros
        swaparr: false // Added swaparr
    },
    configuredAppsInitialized: false, // Track if we've loaded app states at least once
    originalSettings: {}, // Store the full original settings object
    settingsChanged: false, // Legacy flag (auto-save enabled)
    
    // Logo URL
    logoUrl: './static/logo/256.png',
    
    // Element references
    elements: {},
    
    // Initialize the application
    init: function() {
        console.log('[huntarrUI] Initializing UI...');
        
        // EXPOSE huntarrUI to global scope early for modules that need it during loading
        window.huntarrUI = this;
        
        // Skip initialization on login page
        const isLoginPage = document.querySelector('.login-container, #loginForm, .login-form');
        if (isLoginPage) {
            console.log('[huntarrUI] Login page detected, skipping full initialization');
            return;
        }
        
        // Cache frequently used DOM elements
        this.cacheElements();

        // Default: Requestarr enabled until we load settings; NZB Hunt always visible (no dev key required)
        this._enableRequestarr = true;
        this._enableNzbHunt = true;
        fetch('./api/settings')
            .then(r => r.json())
            .then(all => {
                const en = !!(all.general && all.general.enable_requestarr !== false);
                this._enableRequestarr = en;
                const nav = document.getElementById('requestarrNav');
                if (nav) {
                    var onSystem = this.currentSection === 'system' || this.currentSection === 'hunt-manager' || this.currentSection === 'logs' || this.currentSection === 'about';
                    var onSettings = ['settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user'].indexOf(this.currentSection) !== -1;
                    nav.style.display = (onSystem || onSettings) ? 'none' : (en ? '' : 'none');
                }
                if (!en && /^#?requestarr/.test(window.location.hash)) {
                    window.location.hash = '#';
                    this.switchSection('home');
                }
                // NZB Hunt: always visible (desktop and mobile), no dev key required
                this._enableNzbHunt = true;
                var nzbNav = document.getElementById('nzbHuntSupportNav');
                if (nzbNav) nzbNav.style.display = '';
                if (!this.originalSettings) this.originalSettings = {};
                this.originalSettings.general = all.general || {};
                this.updateMovieHuntNavVisibility();
            })
            .catch(() => {});
        
        // Register event handlers
        this.setupEventListeners();
        this.setupLogoHandling();
        // Auto-save enabled - no unsaved changes handler needed
        
        // Check if Low Usage Mode is enabled BEFORE loading stats to avoid race condition
        this.checkLowUsageMode().then(() => {
            // Initialize media stats after low usage mode is determined
            if (window.location.pathname === '/') {
                this.loadMediaStats();
            }
        }).catch(() => {
            // If low usage mode check fails, still load stats
            if (window.location.pathname === '/') {
                this.loadMediaStats();
            }
        });
        
        // Check if we need to navigate to a specific section after refresh
        const targetSection = localStorage.getItem('huntarr-target-section');
        if (targetSection) {
            console.log(`[huntarrUI] Found target section after refresh: ${targetSection}`);
            localStorage.removeItem('huntarr-target-section');
            // Keep URL in sync so hash-based logic and back button work (replaceState avoids firing hashchange)
            if (window.location.hash !== '#' + targetSection) {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#' + targetSection);
            }
            // Navigate to the target section
            this.switchSection(targetSection);
        } else {
            // Initial navigation based on hash
            this.handleHashNavigation(window.location.hash);
        }
        
        // Remove initial sidebar hiding style
        const initialSidebarStyle = document.getElementById('initial-sidebar-state');
        if (initialSidebarStyle) {
            initialSidebarStyle.remove();
        }
        
        // Check which sidebar should be shown based on current section
        console.log(`[huntarrUI] Initialization - current section: ${this.currentSection}`);
        if (this.currentSection === 'settings' || this.currentSection === 'scheduling' || this.currentSection === 'notifications' || this.currentSection === 'backup-restore' || this.currentSection === 'user' || this.currentSection === 'settings-logs') {
            console.log('[huntarrUI] Initialization - showing main sidebar (settings sub-menu)');
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            var settingsSub = document.getElementById('settings-sub');
            if (settingsSub) { settingsSub.classList.add('expanded'); settingsSub.style.display = 'block'; }
        } else if (this.currentSection === 'system' || this.currentSection === 'hunt-manager' || this.currentSection === 'logs' || this.currentSection === 'about') {
            console.log('[huntarrUI] Initialization - showing main sidebar (system sub-menu)');
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            var systemSub = document.getElementById('system-sub');
            if (systemSub) { systemSub.classList.add('expanded'); systemSub.style.display = 'block'; }
        } else if (this.currentSection === 'nzb-hunt-home' || this.currentSection === 'nzb-hunt-activity' || this.currentSection === 'nzb-hunt-settings') {
            console.log('[huntarrUI] Initialization - showing nzb hunt sidebar');
            this.showNzbHuntSidebar();
        } else if (this.currentSection === 'movie-hunt-home' || this.currentSection === 'movie-hunt-collection' || this.currentSection === 'activity-queue' || this.currentSection === 'activity-history' || this.currentSection === 'activity-blocklist' || this.currentSection === 'activity-logs' || this.currentSection === 'logs-movie-hunt' || this.currentSection === 'movie-hunt-settings' || this.currentSection === 'settings-instance-management' || this.currentSection === 'settings-movie-management' || this.currentSection === 'settings-profiles' || this.currentSection === 'settings-sizes' || this.currentSection === 'profile-editor' || this.currentSection === 'settings-custom-formats' || this.currentSection === 'settings-indexers' || this.currentSection === 'settings-clients' || this.currentSection === 'settings-import-lists' || this.currentSection === 'settings-root-folders') {
            console.log('[huntarrUI] Initialization - showing movie hunt sidebar');
            this.showMovieHuntSidebar();
        } else if (this.currentSection === 'requestarr' || this.currentSection === 'requestarr-discover' || this.currentSection === 'requestarr-movies' || this.currentSection === 'requestarr-tv' || this.currentSection === 'requestarr-hidden' || this.currentSection === 'requestarr-settings') {
            if (this._enableRequestarr === false) {
                console.log('[huntarrUI] Requestarr disabled - redirecting to home');
                this.switchSection('home');
            } else {
                console.log('[huntarrUI] Initialization - showing requestarr sidebar');
                this.showRequestarrSidebar();
            }
        } else if (this.currentSection === 'apps' || this.currentSection === 'sonarr' || this.currentSection === 'radarr' || this.currentSection === 'lidarr' || this.currentSection === 'readarr' || this.currentSection === 'whisparr' || this.currentSection === 'eros' || this.currentSection === 'prowlarr' || this.currentSection === 'swaparr') {
            console.log('[huntarrUI] Initialization - showing apps sidebar');
            this.showAppsSidebar();
        } else {
            // Show main sidebar by default and clear settings sidebar preference
            console.log('[huntarrUI] Initialization - showing main sidebar (default)');
            localStorage.removeItem('huntarr-settings-sidebar');
            localStorage.removeItem('huntarr-apps-sidebar');
            this.showMainSidebar();
        }
        
        // Auto-save enabled - no unsaved changes handler needed
        
        // Load username
        this.loadUsername();
        
        // Initialize theme and dark mode
        if (window.HuntarrTheme) {
            window.HuntarrTheme.initDarkMode();
        }

        // Ensure logo is visible immediately
        this.logoUrl = localStorage.getItem('huntarr-logo-url') || this.logoUrl;
        
        // Load current version
        this.loadCurrentVersion(); // Load current version
        
        // Load latest version from GitHub
        this.loadLatestVersion(); // Load latest version from GitHub
        
        // Load latest beta version from GitHub
        this.loadBetaVersion(); // Load latest beta version from GitHub
        
        // Load GitHub star count
        this.loadGitHubStarCount(); // Load GitHub star count
        
        // Preload stateful management info so it's ready when needed
        this.loadStatefulInfo();
        
        // Ensure logo is applied
        if (typeof window.applyLogoToAllElements === 'function') {
            window.applyLogoToAllElements();
        }
        
        // Initialize instance event handlers
        this.setupInstanceEventHandlers();
        
        // Setup navigation for sidebars
        this.setupRequestarrNavigation();
        this.setupMovieHuntNavigation();
        this.setupAppsNavigation();
        this.setupSettingsNavigation();
        this.setupSystemNavigation();
        
        // Auto-save enabled - no unsaved changes handler needed
        
        // Setup Swaparr components
        this.setupSwaparrResetCycle();
        
        // Setup Swaparr status polling (refresh every 30 seconds)
        this.setupSwaparrStatusPolling();
        
        // Setup Prowlarr status polling (refresh every 30 seconds)
        this.setupProwlarrStatusPolling();
        
        // Make dashboard visible after initialization to prevent FOUC
        setTimeout(() => {
            this.showDashboard();
            // Mark as initialized after everything is set up to enable refresh on section changes
            this.isInitialized = true;
            console.log('[huntarrUI] Initialization complete - refresh on section change enabled');
        }, 50); // Reduced from implicit longer delay
    },

    runWhenRequestarrReady: function(actionName, callback) {
        if (window.HuntarrRequestarr) {
            window.HuntarrRequestarr.runWhenRequestarrReady(actionName, callback);
        } else {
            callback();
        }
    },
    
    // Cache DOM elements for better performance
    cacheElements: function() {
        if (window.HuntarrDOM) {
            window.HuntarrDOM.cacheElements(this);
        }
    },
    
    // Set up event listeners
    setupEventListeners: function() {
        // Navigation
        document.addEventListener('click', (e) => {
            // Navigation link handling
            if (e.target.matches('.nav-link') || e.target.closest('.nav-link')) {
                const link = e.target.matches('.nav-link') ? e.target : e.target.closest('.nav-link');
                e.preventDefault();
                this.handleNavigation(e);
            }

            // Main sidebar active state handling (including external links)
            const sidebarNavItem = e.target.closest('#sidebar .nav-item');
            if (sidebarNavItem) {
                const mainSidebarNavItems = document.querySelectorAll('#sidebar .nav-item');
                mainSidebarNavItems.forEach(item => item.classList.remove('active'));
                sidebarNavItem.classList.add('active');
            }
            
            // Handle cycle reset button clicks
            if (e.target.matches('.cycle-reset-button') || e.target.closest('.cycle-reset-button')) {
                const button = e.target.matches('.cycle-reset-button') ? e.target : e.target.closest('.cycle-reset-button');
                const app = button.dataset.app;
                if (app) {
                    this.resetAppCycle(app, button);
                }
            }
        });
        
        // History dropdown toggle
        if (this.elements.historyDropdownBtn) {
            this.elements.historyDropdownBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent event bubbling
                
                // Toggle this dropdown
                this.elements.historyDropdownContent.classList.toggle('show');
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.history-dropdown') && this.elements.historyDropdownContent.classList.contains('show')) {
                    this.elements.historyDropdownContent.classList.remove('show');
                }
            });
        }
        
        // History options
        this.elements.historyOptions.forEach(option => {
            option.addEventListener('click', (e) => this.handleHistoryOptionChange(e));
        });
        
        // Settings dropdown toggle
        if (this.elements.settingsDropdownBtn) {
            this.elements.settingsDropdownBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent event bubbling
                
                // Toggle this dropdown
                this.elements.settingsDropdownContent.classList.toggle('show');
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.settings-dropdown') && this.elements.settingsDropdownContent.classList.contains('show')) {
                    this.elements.settingsDropdownContent.classList.remove('show');
                }
            });
        }
        
        // Settings options
        this.elements.settingsOptions.forEach(option => {
            option.addEventListener('click', (e) => this.handleSettingsOptionChange(e));
        });
        
        // Save settings button
        // Save button removed for auto-save
        
        // Test notification button (delegated event listener for dynamic content)
        document.addEventListener('click', (e) => {
            if (e.target.id === 'testNotificationBtn' || e.target.closest('#testNotificationBtn')) {
                this.testNotification();
            }
        });
        
        // Start hunt button
        if (this.elements.startHuntButton) {
            this.elements.startHuntButton.addEventListener('click', () => this.startHunt());
        }
        
        // Stop hunt button
        if (this.elements.stopHuntButton) {
            this.elements.stopHuntButton.addEventListener('click', () => this.stopHunt());
        }
        
        // Logout button
        if (this.elements.logoutLink) {
            this.elements.logoutLink.addEventListener('click', (e) => this.logout(e));
        }
        
        // Requestarr and Movie Hunt navigation
        this.setupRequestarrNavigation();
        this.setupMovieHuntNavigation();
        
        // Dark mode toggle
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            const prefersDarkMode = localStorage.getItem('huntarr-dark-mode') === 'true';
            darkModeToggle.checked = prefersDarkMode;
            
            darkModeToggle.addEventListener('change', function() {
                const isDarkMode = this.checked;
                document.body.classList.toggle('dark-theme', isDarkMode);
                localStorage.setItem('huntarr-dark-mode', isDarkMode);
            });
        }
        
        // Settings now use manual save - no auto-save setup
        console.log('[huntarrUI] Settings using manual save - skipping auto-save setup');
        
        // Auto-save enabled - no need to warn about unsaved changes
        
        // Stateful management reset button
        const resetStatefulBtn = document.getElementById('reset_stateful_btn');
        if (resetStatefulBtn) {
            resetStatefulBtn.addEventListener('click', () => this.resetStatefulManagement());
        }
        
        // Stateful management hours input
        const statefulHoursInput = document.getElementById('stateful_management_hours');
        if (statefulHoursInput) {
            statefulHoursInput.addEventListener('change', () => {
                this.updateStatefulExpirationOnUI();
            });
        }
        
        // Handle window hash change
        window.addEventListener('hashchange', (e) => {
            // Check for unsaved changes before navigation
            if (window._hasUnsavedChanges) {
                if (!confirm('You have unsaved changes. Are you sure you want to leave this page?')) {
                    // Prevent navigation by going back to previous hash
                    e.preventDefault();
                    history.pushState(null, null, e.oldURL);
                    return;
                }
                // User confirmed, clear the flag
                window._hasUnsavedChanges = false;
            }
            this.handleHashNavigation(window.location.hash);
        });

        // Handle page unload/refresh
        window.addEventListener('beforeunload', (e) => {
            if (window._hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });

        // Settings form delegation - now triggers auto-save
        const settingsFormContainer = document.querySelector('#settingsSection');
        if (settingsFormContainer) {
            // Settings now use manual save - remove auto-save event listeners
            console.log('[huntarrUI] Settings section using manual save - no auto-save listeners');
        }

        // Auto-save enabled - no need for beforeunload warnings

        // Initial setup based on hash or default to home
        const initialHash = window.location.hash || '#home';
        this.handleHashNavigation(initialHash);

        // HISTORY: Listen for change on #historyAppSelect
        const historyAppSelect = document.getElementById('historyAppSelect');
        if (historyAppSelect) {
            historyAppSelect.addEventListener('change', (e) => {
                const app = e.target.value;
                this.handleHistoryOptionChange(app);
            });
        }

        // Reset stats button
        const resetButton = document.getElementById('reset-stats');
        if (resetButton) {
            resetButton.addEventListener('click', (e) => {
                e.preventDefault();
                this.resetMediaStats();
            });
        }
    },
    
    // Setup logo handling to prevent flashing during navigation
    setupLogoHandling: function() {
        if (window.HuntarrTheme) {
            window.HuntarrTheme.setupLogoHandling();
        }
    },
    
    // Navigation handling
    handleNavigation: function(e) {
        if (window.HuntarrNavigation) {
            window.HuntarrNavigation.handleNavigation(e);
        }
    },
    
    handleHashNavigation: function(hash) {
        if (window.HuntarrNavigation) {
            window.HuntarrNavigation.handleHashNavigation(hash);
        }
    },
    
    switchSection: function(section) {
        console.log(`[huntarrUI] *** SWITCH SECTION CALLED *** section: ${section}, current: ${this.currentSection}`);
        
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
            if (this.currentSection === 'settings-movie-management' && section !== 'settings-movie-management' && window.MovieManagement && typeof window.MovieManagement.isDirty === 'function' && window.MovieManagement.isDirty()) {
                window.MovieManagement.confirmLeave(function(result) {
                    if (result === 'save') {
                        window.MovieManagement.save(section);
                    } else if (result === 'discard') {
                        window.MovieManagement.cancel(section);
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
            
            // Don't refresh page when navigating to/from instance editor or between app sections
            const noRefreshSections = ['home', 'instance-editor', 'profile-editor', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'swaparr', 'movie-hunt-home', 'movie-hunt-collection', 'activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-movie-hunt', 'movie-hunt-settings', 'settings-instance-management', 'settings-movie-management', 'settings-profiles', 'settings-sizes', 'settings-indexers', 'settings-clients', 'settings-import-lists', 'settings-custom-formats', 'settings-root-folders', 'system', 'hunt-manager', 'logs', 'about', 'settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user', 'nzb-hunt-home', 'nzb-hunt-activity', 'nzb-hunt-settings'];
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
            
            // Show main sidebar when returning to home and clear settings sidebar preference
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            
            // Disconnect logs if switching away from logs
            this.disconnectAllEventSources(); 
            
            // Check app connections when returning to home page to update status
            // This will call updateEmptyStateVisibility() after all checks complete
            this.checkAppConnections();
            // Load Swaparr status
            this.loadSwaparrStatus();
            // Stats are already loaded, no need to reload unless data changed
            // this.loadMediaStats();
        } else if (section === 'logs-movie-hunt' && this.elements.logsSection) {
            // Movie Hunt logs - show logsSection under Movie Hunt sidebar (hide tab bar)
            var activitySection = document.getElementById('activitySection');
            if (activitySection) { activitySection.classList.remove('active'); activitySection.style.display = 'none'; }
            var systemSection = document.getElementById('systemSection');
            if (systemSection) { systemSection.classList.add('active'); systemSection.style.display = 'block'; }
            if (window.HuntarrNavigation) window.HuntarrNavigation.switchSystemTab('logs');
            newTitle = 'Logs';
            this.currentSection = section;
            this.showMovieHuntSidebar();
            var logAppSelect = document.getElementById('logAppSelect');
            if (logAppSelect) logAppSelect.value = 'movie_hunt';
            if (window.LogsModule) window.LogsModule.currentLogApp = 'movie_hunt';
            if (window.LogsModule && typeof window.LogsModule.updateDebugLevelVisibility === 'function') {
                window.LogsModule.updateDebugLevelVisibility();
            }
            if (window.LogsModule) {
                try {
                    if (window.LogsModule.initialized) { window.LogsModule.connectToLogs(); }
                    else { window.LogsModule.init(); }
                } catch (error) { console.error('[huntarrUI] Error during LogsModule calls:', error); }
            }
        } else if ((section === 'system' || section === 'hunt-manager' || section === 'logs' || section === 'about') && document.getElementById('systemSection')) {
            // System section with sidebar sub-navigation (Hunt Manager, Logs, About)
            var systemSection = document.getElementById('systemSection');
            systemSection.classList.add('active');
            systemSection.style.display = 'block';
            
            // Determine which tab to show
            var activeTab = section === 'system' ? 'hunt-manager' : section;
            if (window.HuntarrNavigation) window.HuntarrNavigation.switchSystemTab(activeTab);
            
            // Set title based on active tab
            var tabTitles = { 'hunt-manager': 'Hunt Manager', 'logs': 'Logs', 'about': 'About' };
            newTitle = tabTitles[activeTab] || 'System';
            this.currentSection = section === 'system' ? 'hunt-manager' : section;
            
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            
            // Mark the correct sidebar sub-item active (AFTER showMainSidebar)
            var subNavMap = { 'hunt-manager': 'mainSystemHuntManagerNav', 'logs': 'mainSystemLogsNav', 'about': 'mainSystemAboutNav' };
            var activeSubNav = document.getElementById(subNavMap[activeTab]);
            if (activeSubNav) activeSubNav.classList.add('active');
            
            // Expand the system sub-group in sidebar (set inline to override CSS)
            var systemSubGroup = document.getElementById('system-sub');
            if (systemSubGroup) {
                systemSubGroup.classList.add('expanded');
                systemSubGroup.style.display = 'block';
            }
            // Collapse settings sub-group
            var settingsSubGroup = document.getElementById('settings-sub');
            if (settingsSubGroup) {
                settingsSubGroup.classList.remove('expanded');
                settingsSubGroup.style.display = 'none';
            }
            
            // Initialize the active tab's module
            if (activeTab === 'hunt-manager') {
                if (typeof huntManagerModule !== 'undefined') huntManagerModule.refresh();
            } else if (activeTab === 'logs') {
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
        } else if (section === 'nzb-hunt-settings' && document.getElementById('nzb-hunt-settings-section')) {
            if (!this._enableNzbHunt) { this.switchSection('home'); return; }
            document.getElementById('nzb-hunt-settings-section').classList.add('active');
            document.getElementById('nzb-hunt-settings-section').style.display = 'block';
            newTitle = 'NZB Hunt – Settings';
            this.currentSection = 'nzb-hunt-settings';
            this.showNzbHuntSidebar();
            if (window.NzbHunt && typeof window.NzbHunt.initSettings === 'function') {
                window.NzbHunt.initSettings();
            }
            if (window._nzbHuntSettingsTab === 'servers' && window.NzbHunt && typeof window.NzbHunt._showSettingsTab === 'function') {
                window.NzbHunt._showSettingsTab('servers');
                delete window._nzbHuntSettingsTab;
                if (window.location.hash !== '#nzb-hunt-settings') {
                    window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-settings');
                }
            }
        } else if ((section === 'requestarr' || section.startsWith('requestarr-')) && this._enableRequestarr === false) {
            this.switchSection('home');
            return;
        } else if (section === 'movie-hunt-home' && document.getElementById('movie-hunt-section')) {
            document.getElementById('movie-hunt-section').classList.add('active');
            document.getElementById('movie-hunt-section').style.display = 'block';
            if (document.getElementById('activitySection')) {
                document.getElementById('activitySection').classList.remove('active');
                document.getElementById('activitySection').style.display = 'none';
            }
            if (document.getElementById('movieHuntHomeNav')) document.getElementById('movieHuntHomeNav').classList.add('active');
            if (document.getElementById('movieHuntCollectionNav')) document.getElementById('movieHuntCollectionNav').classList.remove('active');
            var mainContent = document.querySelector('#movie-hunt-section .requestarr-content');
            var collectionView = document.getElementById('movie-hunt-collection-view');
            if (mainContent) { mainContent.style.display = ''; }
            if (collectionView) { collectionView.style.display = 'none'; }
            newTitle = 'Movie Hunt';
            this.currentSection = 'movie-hunt-home';
            this.showMovieHuntSidebar();
            if (window.MovieHunt && typeof window.MovieHunt.init === 'function') {
                window.MovieHunt.init();
            }
        } else if (section === 'movie-hunt-collection' && document.getElementById('movie-hunt-section')) {
            document.getElementById('movie-hunt-section').classList.add('active');
            document.getElementById('movie-hunt-section').style.display = 'block';
            if (document.getElementById('activitySection')) {
                document.getElementById('activitySection').classList.remove('active');
                document.getElementById('activitySection').style.display = 'none';
            }
            if (document.getElementById('movieHuntHomeNav')) document.getElementById('movieHuntHomeNav').classList.remove('active');
            if (document.getElementById('movieHuntCollectionNav')) document.getElementById('movieHuntCollectionNav').classList.add('active');
            var mainContent = document.querySelector('#movie-hunt-section .requestarr-content');
            var collectionView = document.getElementById('movie-hunt-collection-view');
            if (mainContent) { mainContent.style.display = 'none'; }
            if (collectionView) { collectionView.style.display = 'block'; }
            newTitle = 'Media Collection';
            this.currentSection = 'movie-hunt-collection';
            this.showMovieHuntSidebar();
            if (window.MovieHuntCollection && typeof window.MovieHuntCollection.init === 'function') {
                window.MovieHuntCollection.init();
            }
        } else if ((section === 'activity-queue' || section === 'activity-history' || section === 'activity-blocklist' || section === 'activity-logs') && document.getElementById('activitySection')) {
            document.getElementById('activitySection').classList.add('active');
            document.getElementById('activitySection').style.display = 'block';
            if (document.getElementById('movie-hunt-section')) {
                document.getElementById('movie-hunt-section').classList.remove('active');
                document.getElementById('movie-hunt-section').style.display = 'none';
            }
            var view = section === 'activity-queue' ? 'queue' : section === 'activity-history' ? 'history' : section === 'activity-blocklist' ? 'blocklist' : 'logs';
            newTitle = section === 'activity-queue' ? 'Activity – Queue' : section === 'activity-history' ? 'Activity – History' : section === 'activity-blocklist' ? 'Activity – Blocklist' : 'Activity – Logs';
            this.currentSection = section;
            this.showMovieHuntSidebar();
            if (window.ActivityModule && typeof window.ActivityModule.init === 'function') {
                window.ActivityModule.init(view);
            }
        } else if (section === 'movie-hunt-settings' && document.getElementById('movie-hunt-settings-default-section')) {
            document.getElementById('movie-hunt-settings-default-section').classList.add('active');
            document.getElementById('movie-hunt-settings-default-section').style.display = 'block';
            if (document.getElementById('instanceManagementSection')) {
                document.getElementById('instanceManagementSection').classList.remove('active');
                document.getElementById('instanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieHuntSettingsNav')) document.getElementById('movieHuntSettingsNav').classList.add('active');
            newTitle = 'Movie Hunt Settings';
            this.currentSection = 'movie-hunt-settings';
            this.showMovieHuntSidebar();
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
                window.RequestarrDiscover.switchView('discover');
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
                window.RequestarrDiscover.switchView('discover');
            });
        } else if (section === 'requestarr-movies' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrMoviesNav')) document.getElementById('requestarrMoviesNav').classList.add('active');
            newTitle = 'Movies';
            this.currentSection = 'requestarr-movies';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Force movies view layout immediately
            const viewIds = [
                'requestarr-discover-view',
                'requestarr-movies-view',
                'requestarr-tv-view',
                'requestarr-hidden-view',
                'requestarr-settings-view'
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
                window.RequestarrDiscover.switchView('movies');
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
                window.RequestarrDiscover.switchView('tv');
            });
        } else if (section === 'requestarr-hidden' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrHiddenNav')) document.getElementById('requestarrHiddenNav').classList.add('active');
            newTitle = 'Hidden Media';
            this.currentSection = 'requestarr-hidden';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show hidden view
            this.runWhenRequestarrReady('hidden', () => {
                window.RequestarrDiscover.switchView('hidden');
            });
        } else if (section === 'requestarr-settings' && document.getElementById('requestarr-section')) {
            document.getElementById('requestarr-section').classList.add('active');
            document.getElementById('requestarr-section').style.display = 'block';
            if (document.getElementById('requestarrSettingsNav')) document.getElementById('requestarrSettingsNav').classList.add('active');
            newTitle = 'Settings';
            this.currentSection = 'requestarr-settings';
            
            // Switch to Requestarr sidebar
            this.showRequestarrSidebar();
            
            // Show settings view
            this.runWhenRequestarrReady('settings', () => {
                window.RequestarrDiscover.switchView('settings');
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
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            var settingsSub = document.getElementById('settings-sub');
            if (settingsSub) settingsSub.classList.add('expanded');
            this.initializeSettings();
        } else if (section === 'settings-instance-management' && document.getElementById('instanceManagementSection')) {
            document.getElementById('instanceManagementSection').classList.add('active');
            document.getElementById('instanceManagementSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsInstanceManagementNav')) document.getElementById('movieHuntSettingsInstanceManagementNav').classList.add('active');
            if (document.getElementById('movie-hunt-settings-default-section')) {
                document.getElementById('movie-hunt-settings-default-section').classList.remove('active');
                document.getElementById('movie-hunt-settings-default-section').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsProfilesSection')) {
                document.getElementById('settingsProfilesSection').classList.remove('active');
                document.getElementById('settingsProfilesSection').style.display = 'none';
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
            if (window.MovieHuntInstanceManagement && typeof window.MovieHuntInstanceManagement.init === 'function') {
                window.MovieHuntInstanceManagement.init();
            }
        } else if (section === 'settings-movie-management' && document.getElementById('movieManagementSection')) {
            document.getElementById('movieManagementSection').classList.add('active');
            document.getElementById('movieManagementSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsMovieManagementNav')) document.getElementById('movieHuntSettingsMovieManagementNav').classList.add('active');
            if (document.getElementById('instanceManagementSection')) {
                document.getElementById('instanceManagementSection').classList.remove('active');
                document.getElementById('instanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsProfilesSection')) {
                document.getElementById('settingsProfilesSection').classList.remove('active');
                document.getElementById('settingsProfilesSection').style.display = 'none';
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
            newTitle = 'Movie Management';
            this.currentSection = 'settings-movie-management';
            this.showMovieHuntSidebar();
            if (window.MovieManagement && typeof window.MovieManagement.load === 'function') {
                window.MovieManagement.load();
            }
        } else if (section === 'settings-profiles' && document.getElementById('settingsProfilesSection')) {
            document.getElementById('settingsProfilesSection').classList.add('active');
            document.getElementById('settingsProfilesSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsProfilesNav')) document.getElementById('movieHuntSettingsProfilesNav').classList.add('active');
            if (document.getElementById('instanceManagementSection')) {
                document.getElementById('instanceManagementSection').classList.remove('active');
                document.getElementById('instanceManagementSection').style.display = 'none';
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
            if (window.SettingsForms && typeof window.SettingsForms.refreshProfilesList === 'function') {
                window.SettingsForms.refreshProfilesList();
            }
        } else if (section === 'settings-sizes' && document.getElementById('settingsSizesSection')) {
            document.getElementById('settingsSizesSection').classList.add('active');
            document.getElementById('settingsSizesSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsSizesNav')) document.getElementById('movieHuntSettingsSizesNav').classList.add('active');
            if (document.getElementById('instanceManagementSection')) {
                document.getElementById('instanceManagementSection').classList.remove('active');
                document.getElementById('instanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsProfilesSection')) {
                document.getElementById('settingsProfilesSection').classList.remove('active');
                document.getElementById('settingsProfilesSection').style.display = 'none';
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
            newTitle = 'Sizes';
            this.currentSection = 'settings-sizes';
            this.showMovieHuntSidebar();
            if (window.SizesModule && typeof window.SizesModule.load === 'function') {
                window.SizesModule.load();
            }
        } else if (section === 'settings-custom-formats' && document.getElementById('settingsCustomFormatsSection')) {
            document.getElementById('settingsCustomFormatsSection').classList.add('active');
            document.getElementById('settingsCustomFormatsSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsCustomFormatsNav')) document.getElementById('movieHuntSettingsCustomFormatsNav').classList.add('active');
            if (document.getElementById('instanceManagementSection')) {
                document.getElementById('instanceManagementSection').classList.remove('active');
                document.getElementById('instanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsProfilesSection')) {
                document.getElementById('settingsProfilesSection').classList.remove('active');
                document.getElementById('settingsProfilesSection').style.display = 'none';
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
            if (window.CustomFormats && typeof window.CustomFormats.refreshList === 'function') {
                window.CustomFormats.refreshList();
            }
        } else if (section === 'profile-editor' && document.getElementById('profileEditorSection')) {
            document.getElementById('profileEditorSection').classList.add('active');
            document.getElementById('profileEditorSection').style.display = 'block';
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsProfilesSection')) {
                document.getElementById('settingsProfilesSection').classList.remove('active');
                document.getElementById('settingsProfilesSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            if (document.getElementById('settingsCustomFormatsSection')) {
                document.getElementById('settingsCustomFormatsSection').classList.remove('active');
                document.getElementById('settingsCustomFormatsSection').style.display = 'none';
            }
            if (document.getElementById('movieHuntSettingsProfilesNav')) document.getElementById('movieHuntSettingsProfilesNav').classList.add('active');
            newTitle = 'Profile Editor';
            this.currentSection = 'profile-editor';
            this.showMovieHuntSidebar();
        } else if (section === 'settings-indexers' && document.getElementById('settingsIndexersSection')) {
            document.getElementById('settingsIndexersSection').classList.add('active');
            document.getElementById('settingsIndexersSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsIndexersNav')) document.getElementById('movieHuntSettingsIndexersNav').classList.add('active');
            if (document.getElementById('instanceManagementSection')) {
                document.getElementById('instanceManagementSection').classList.remove('active');
                document.getElementById('instanceManagementSection').style.display = 'none';
            }
            if (document.getElementById('movieManagementSection')) {
                document.getElementById('movieManagementSection').classList.remove('active');
                document.getElementById('movieManagementSection').style.display = 'none';
            }
            if (document.getElementById('settingsSizesSection')) {
                document.getElementById('settingsSizesSection').classList.remove('active');
                document.getElementById('settingsSizesSection').style.display = 'none';
            }
            newTitle = 'Indexers';
            this.currentSection = 'settings-indexers';
            this.showMovieHuntSidebar();
            if (window.SettingsForms && typeof window.SettingsForms.refreshIndexersList === 'function') {
                window.SettingsForms.refreshIndexersList();
            }
        } else if (section === 'settings-clients' && document.getElementById('settingsClientsSection')) {
            document.getElementById('settingsClientsSection').classList.add('active');
            document.getElementById('settingsClientsSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsClientsNav')) document.getElementById('movieHuntSettingsClientsNav').classList.add('active');
            if (document.getElementById('instanceManagementSection')) {
                document.getElementById('instanceManagementSection').classList.remove('active');
                document.getElementById('instanceManagementSection').style.display = 'none';
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
            document.getElementById('settingsImportListsSection').classList.add('active');
            document.getElementById('settingsImportListsSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsImportListsNav')) document.getElementById('movieHuntSettingsImportListsNav').classList.add('active');
            if (document.getElementById('instanceManagementSection')) {
                document.getElementById('instanceManagementSection').classList.remove('active');
                document.getElementById('instanceManagementSection').style.display = 'none';
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
            if (window.ImportLists && typeof window.ImportLists.refreshList === 'function') {
                window.ImportLists.refreshList();
            }
        } else if (section === 'settings-root-folders' && document.getElementById('settingsRootFoldersSection')) {
            document.getElementById('settingsRootFoldersSection').classList.add('active');
            document.getElementById('settingsRootFoldersSection').style.display = 'block';
            if (document.getElementById('movieHuntSettingsRootFoldersNav')) document.getElementById('movieHuntSettingsRootFoldersNav').classList.add('active');
            if (document.getElementById('instanceManagementSection')) {
                document.getElementById('instanceManagementSection').classList.remove('active');
                document.getElementById('instanceManagementSection').style.display = 'none';
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
            if (window.RootFolders && typeof window.RootFolders.refreshList === 'function') {
                window.RootFolders.refreshList();
            }
        } else if (section === 'settings-logs' && document.getElementById('settingsLogsSection')) {
            document.getElementById('settingsLogsSection').classList.add('active');
            document.getElementById('settingsLogsSection').style.display = 'block';
            newTitle = 'Log Settings';
            this.currentSection = 'settings-logs';
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            var settingsSub = document.getElementById('settings-sub');
            if (settingsSub) settingsSub.classList.add('expanded');
            this.initializeLogsSettings();
        } else if (section === 'scheduling' && document.getElementById('schedulingSection')) {
            document.getElementById('schedulingSection').classList.add('active');
            document.getElementById('schedulingSection').style.display = 'block';
            newTitle = 'Scheduling';
            this.currentSection = 'scheduling';
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            var settingsSub = document.getElementById('settings-sub');
            if (settingsSub) settingsSub.classList.add('expanded');
            if (typeof window.refreshSchedulingInstances === 'function') {
                window.refreshSchedulingInstances();
            }
        } else if (section === 'notifications' && document.getElementById('notificationsSection')) {
            document.getElementById('notificationsSection').classList.add('active');
            document.getElementById('notificationsSection').style.display = 'block';
            newTitle = 'Notifications';
            this.currentSection = 'notifications';
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            var settingsSub = document.getElementById('settings-sub');
            if (settingsSub) settingsSub.classList.add('expanded');
            this.initializeNotifications();
        } else if (section === 'backup-restore' && document.getElementById('backupRestoreSection')) {
            document.getElementById('backupRestoreSection').classList.add('active');
            document.getElementById('backupRestoreSection').style.display = 'block';
            newTitle = 'Backup / Restore';
            this.currentSection = 'backup-restore';
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            var settingsSub = document.getElementById('settings-sub');
            if (settingsSub) settingsSub.classList.add('expanded');
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
            localStorage.removeItem('huntarr-settings-sidebar');
            this.showMainSidebar();
            var settingsSub = document.getElementById('settings-sub');
            if (settingsSub) settingsSub.classList.add('expanded');
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
                newTitle = 'Instance Editor';
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
            
            // Show main sidebar and clear settings sidebar preference
            localStorage.removeItem('huntarr-settings-sidebar');
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

        // Hide CORE "Home" nav link only when we're on the home page; show it on Settings, System, etc.
        if (this.elements.homeNav) {
            if (this.currentSection === 'home') {
                this.elements.homeNav.classList.add('nav-item-core-home-hidden');
            } else {
                this.elements.homeNav.classList.remove('nav-item-core-home-hidden');
            }
        }
    },
    
    // Sidebar switching functions
    _hideAllSidebars: function() {
        document.getElementById('sidebar').style.display = 'none';
        document.getElementById('apps-sidebar').style.display = 'none';
        document.getElementById('settings-sidebar').style.display = 'none';
        document.getElementById('requestarr-sidebar').style.display = 'none';
        var mh = document.getElementById('movie-hunt-sidebar');
        if (mh) mh.style.display = 'none';
        var nh = document.getElementById('nzb-hunt-sidebar');
        if (nh) nh.style.display = 'none';
    },

    showMainSidebar: function() {
        this._hideAllSidebars();
        document.getElementById('sidebar').style.display = 'flex';
        // When on System (Hunt Manager, Logs, About), hide Settings, Requestarr, Apps in main sidebar
        var section = this.currentSection;
        var onSystem = section === 'system' || section === 'hunt-manager' || section === 'logs' || section === 'about';
        var onSettings = ['settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user'].indexOf(section) !== -1;
        var settingsNav = document.getElementById('settingsNav');
        var settingsSubGroup = document.getElementById('settings-sub');
        var requestarrNav = document.getElementById('requestarrNav');
        var appsNav = document.getElementById('appsNav');
        var systemNav = document.getElementById('systemNav');
        var systemSubGroup = document.getElementById('system-sub');
        if (settingsNav) settingsNav.style.display = onSystem ? 'none' : '';
        if (settingsSubGroup) settingsSubGroup.style.display = onSystem ? 'none' : (onSettings ? 'block' : 'none');
        if (requestarrNav) requestarrNav.style.display = (onSystem || onSettings) ? 'none' : '';
        if (appsNav) appsNav.style.display = (onSystem || onSettings) ? 'none' : '';
        if (systemNav) systemNav.style.display = onSettings ? 'none' : '';
        if (systemSubGroup) systemSubGroup.style.display = onSettings ? 'none' : (onSystem ? 'block' : 'none');
        // Ensure expanded classes match
        if (settingsSubGroup) settingsSubGroup.classList.toggle('expanded', onSettings);
        if (systemSubGroup) systemSubGroup.classList.toggle('expanded', onSystem);
        this._updateMainSidebarBetaVisibility();
    },

    /** When on Settings (main, scheduling, notifications, backup-restore, logs, user) or System (hunt-manager, logs, about), hide Beta and Movie Hunt in main sidebar. */
    _updateMainSidebarBetaVisibility: function() {
        var hideBetaSections = ['settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user', 'system', 'hunt-manager', 'logs', 'about'];
        var hide = hideBetaSections.indexOf(this.currentSection) !== -1;
        var betaGroup = document.getElementById('main-sidebar-beta-group');
        if (betaGroup) betaGroup.style.display = hide ? 'none' : '';
    },
    
    showAppsSidebar: function() {
        this._hideAllSidebars();
        document.getElementById('apps-sidebar').style.display = 'flex';
    },
    
    showSettingsSidebar: function() {
        this._hideAllSidebars();
        document.getElementById('settings-sidebar').style.display = 'flex';
    },
    
    showRequestarrSidebar: function() {
        this._hideAllSidebars();
        document.getElementById('requestarr-sidebar').style.display = 'flex';
    },

    showMovieHuntSidebar: function() {
        this._hideAllSidebars();
        var mh = document.getElementById('movie-hunt-sidebar');
        if (mh) mh.style.display = 'flex';
        if (window.HuntarrNavigation && typeof window.HuntarrNavigation.updateMovieHuntSidebarActive === 'function') {
            window.HuntarrNavigation.updateMovieHuntSidebarActive();
        }
        this._updateMovieHuntSidebarSettingsOnlyVisibility();
    },

    showNzbHuntSidebar: function() {
        this._hideAllSidebars();
        var nh = document.getElementById('nzb-hunt-sidebar');
        if (nh) nh.style.display = 'flex';
        // Update active nav item
        var items = document.querySelectorAll('#nzb-hunt-sidebar .nav-item');
        for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
        var section = this.currentSection;
        if (section === 'nzb-hunt-home') {
            var n = document.getElementById('nzbHuntHomeNav');
            if (n) n.classList.add('active');
        } else if (section === 'nzb-hunt-activity') {
            var n = document.getElementById('nzbHuntActivityNav');
            if (n) n.classList.add('active');
        } else if (section === 'nzb-hunt-settings') {
            var n = document.getElementById('nzbHuntSettingsNav');
            if (n) n.classList.add('active');
        }
    },

    /** When on Settings subpages: hide Huntarr+Home, Media Collection, Activity. When on Activity (Queue/History/Blocklist/Logs): hide Huntarr+Home, Settings. */
    _updateMovieHuntSidebarSettingsOnlyVisibility: function() {
        var settingsSections = ['movie-hunt-settings', 'settings-instance-management', 'settings-movie-management', 'settings-profiles', 'settings-sizes', 'settings-custom-formats', 'settings-indexers', 'settings-clients', 'settings-import-lists', 'settings-root-folders'];
        var activitySections = ['activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-movie-hunt'];
        var onSettings = settingsSections.indexOf(this.currentSection) !== -1;
        var onActivity = activitySections.indexOf(this.currentSection) !== -1;
        var showDisplay = '';
        var huntarrHome = document.getElementById('movie-hunt-sidebar-huntarr-home-group');
        var collectionNav = document.getElementById('movieHuntCollectionNav');
        var activityNav = document.getElementById('movieHuntActivityNav');
        var activitySub = document.getElementById('movie-hunt-activity-sub');
        var settingsNav = document.getElementById('movieHuntSettingsNav');
        var settingsSub = document.getElementById('movie-hunt-settings-sub');
        if (huntarrHome) huntarrHome.style.display = (onSettings || onActivity) ? 'none' : showDisplay;
        if (collectionNav) collectionNav.style.display = (onSettings || onActivity) ? 'none' : showDisplay;
        if (activityNav) activityNav.style.display = onSettings ? 'none' : showDisplay;
        if (activitySub) activitySub.style.display = onSettings ? 'none' : showDisplay;
        if (settingsNav) settingsNav.style.display = onActivity ? 'none' : showDisplay;
        if (settingsSub) settingsSub.style.display = onActivity ? 'none' : showDisplay;
    },

    /** When in instance-editor for indexer/client, keep Indexers or Clients nav item highlighted. */
    _highlightMovieHuntNavForEditor: function(appType) {
        var subGroup = document.getElementById('movie-hunt-settings-sub');
        if (subGroup) subGroup.classList.add('expanded');
        var items = document.querySelectorAll('#movie-hunt-sidebar .nav-item');
        for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
        var nav = appType === 'indexer' ? document.getElementById('movieHuntSettingsIndexersNav') : document.getElementById('movieHuntSettingsClientsNav');
        if (nav) nav.classList.add('active');
    },

    /** Legacy: was used to show/hide Movie Hunt in Core by dev_mode. Movie Hunt is now in Beta and always visible. */
    updateMovieHuntNavVisibility: function() {
        const mhNav = document.getElementById('movieHuntNav');
        if (mhNav) mhNav.style.display = 'none'; // Core Movie Hunt removed; Beta Movie Hunt is always visible
    },
    
    // Simple event source disconnection for compatibility
    disconnectAllEventSources: function() {
        // Delegate to LogsModule if it exists
        if (window.LogsModule && typeof window.LogsModule.disconnectAllEventSources === 'function') {
            window.LogsModule.disconnectAllEventSources();
        }
        // Clear local references
        this.eventSources = {};
    },
    
    // App tab switching
    handleAppTabChange: function(e) {
        const app = e.target.getAttribute('data-app');
        if (!app) return;
        
        // Update active tab
        this.elements.appTabs.forEach(tab => {
            tab.classList.remove('active');
        });
        e.target.classList.add('active');
        
        // Let LogsModule handle app switching to preserve pagination
        this.currentApp = app;
        if (window.LogsModule && typeof window.LogsModule.handleAppChange === 'function') {
            window.LogsModule.handleAppChange(app);
        }
    },
    
    // Log option dropdown handling - Delegated to LogsModule
    // (Removed to prevent conflicts with LogsModule.handleLogOptionChange)
    
    // History option dropdown handling
    handleHistoryOptionChange: function(app) {
        if (window.HuntarrUIHandlers) {
            window.HuntarrUIHandlers.handleHistoryOptionChange(app);
        }
    },
    
    // Update the history placeholder text based on the selected app
    updateHistoryPlaceholder: function(app) {
        if (window.HuntarrUIHandlers) {
            window.HuntarrUIHandlers.updateHistoryPlaceholder(app);
        }
    },
    
    // Settings option handling
    handleSettingsOptionChange: function(e) {
        if (window.HuntarrUIHandlers) {
            window.HuntarrUIHandlers.handleSettingsOptionChange(e);
        }
    },
    
    // Compatibility methods that delegate to LogsModule
    connectToLogs: function() {
        if (window.HuntarrLogs) {
            window.HuntarrLogs.connectToLogs();
        }
    },
    
    clearLogs: function() {
        if (window.LogsModule && typeof window.LogsModule.clearLogs === 'function') {
            window.LogsModule.clearLogs(true); // true = from user action (e.g. button/menu)
        }
    },
    
    insertLogInChronologicalOrder: function(newLogEntry) {
        if (window.HuntarrLogs) {
            window.HuntarrLogs.insertLogInChronologicalOrder(newLogEntry);
        }
    },
    
    parseLogTimestamp: function(logEntry) {
        return window.HuntarrLogs ? window.HuntarrLogs.parseLogTimestamp(logEntry) : null;
    },
    
    searchLogs: function() {
        if (window.HuntarrLogs) {
            window.HuntarrLogs.searchLogs();
        }
    },
    
    simpleHighlightMatch: function(logEntry, searchText) {
        if (window.HuntarrLogs) {
            window.HuntarrLogs.simpleHighlightMatch(logEntry, searchText);
        }
    },
    
    clearLogSearch: function() {
        if (window.HuntarrLogs) {
            window.HuntarrLogs.clearLogSearch();
        }
    },
    
    // Settings handling
    loadAllSettings: function() {
        if (window.HuntarrSettings) {
            window.HuntarrSettings.loadAllSettings();
        }
    },
    
    populateSettingsForm: function(app, appSettings) {
        if (window.HuntarrSettings) {
            window.HuntarrSettings.populateSettingsForm(app, appSettings);
        }
    },
    
    // Called when any setting input changes in the active tab
    markSettingsAsChanged() {
        console.log("[huntarrUI] markSettingsAsChanged called, current state:", this.settingsChanged);
        if (!this.settingsChanged) {
            console.log("[huntarrUI] Settings marked as changed. Enabling save button.");
            this.settingsChanged = true;
            this.updateSaveResetButtonState(true); // Enable buttons
        } else {
            console.log("[huntarrUI] Settings already marked as changed.");
        }
    },

    saveSettings: function() {
        if (window.HuntarrSettings) {
            window.HuntarrSettings.saveSettings();
        }
    },

    // Update save button state
    updateSaveResetButtonState(enable) {
        const saveBtn = document.getElementById('settings-save-button');
        const notifSaveBtn = document.getElementById('notifications-save-button');
        
        console.log('[huntarrUI] updateSaveResetButtonState called with enable:', enable);
        console.log('[huntarrUI] Found buttons - settings:', !!saveBtn, 'notifications:', !!notifSaveBtn);
        
        [saveBtn, notifSaveBtn].forEach(btn => {
            if (!btn) return;
            
            console.log('[huntarrUI] Updating button:', btn.id, 'enabled:', enable);
            
            if (enable) {
                btn.disabled = false;
                btn.style.background = '#dc2626'; // Red color for enabled state
                btn.style.color = '#ffffff';
                btn.style.borderColor = '#b91c1c';
                btn.style.cursor = 'pointer';
                btn.style.boxShadow = '0 0 10px rgba(220, 38, 38, 0.3)';
            } else {
                btn.disabled = true;
                btn.style.background = '#6b7280';
                btn.style.color = '#9ca3af';
                btn.style.borderColor = '#4b5563';
                btn.style.cursor = 'not-allowed';
                btn.style.boxShadow = 'none';
            }
        });
    },

    // Setup auto-save for settings
    setupSettingsAutoSave: function() {
        if (window.HuntarrSettings) {
            window.HuntarrSettings.setupSettingsAutoSave();
        }
    },

    // Trigger immediate auto-save
    triggerSettingsAutoSave: function() {
        if (window.HuntarrSettings) {
            window.HuntarrSettings.triggerSettingsAutoSave();
        }
    },

    // Auto-save settings function
    autoSaveSettings: function(app) {
        if (window.HuntarrSettings) {
            window.HuntarrSettings.autoSaveSettings(app);
        }
    },

    // Clean URL by removing special characters from the end
    cleanUrlString: function(url) {
        if (!url) return "";
        
        // Trim whitespace first
        let cleanUrl = url.trim();
        
        // First remove any trailing slashes
        cleanUrl = cleanUrl.replace(/[\/\\]+$/g, '');
        
        // Then remove any other trailing special characters
        // This regex will match any special character at the end that is not alphanumeric, hyphen, period, or underscore
        return cleanUrl.replace(/[^a-zA-Z0-9\-\._]$/g, '');
    },
    
    // Get settings from the form, updated to handle instances consistently
    getFormSettings: function(app) {
        return window.HuntarrSettings ? window.HuntarrSettings.getFormSettings(app) : null;
    },

    // Test notification functionality
    testNotification: function() {
        if (window.HuntarrSettings) {
            window.HuntarrSettings.testNotification();
        }
    },

    autoSaveGeneralSettings: function(silent = false) {
        return window.HuntarrSettings ? window.HuntarrSettings.autoSaveGeneralSettings(silent) : Promise.resolve();
    },

    autoSaveSwaparrSettings: function(silent = false) {
        return window.HuntarrSettings ? window.HuntarrSettings.autoSaveSwaparrSettings(silent) : Promise.resolve();
    },
    
    // Handle instance management events
    setupInstanceEventHandlers: function() {
        if (window.HuntarrInstances) {
            window.HuntarrInstances.setupInstanceEventHandlers();
        }
    },
    
    // Add a new instance to the app
    addAppInstance: function(appName) {
        if (window.HuntarrInstances) {
            window.HuntarrInstances.addAppInstance(appName);
        }
    },
    
    // Remove an instance
    removeAppInstance: function(appName, instanceId) {
        if (window.HuntarrInstances) {
            window.HuntarrInstances.removeAppInstance(appName, instanceId);
        }
    },
    
    // Test connection for a specific instance
    testInstanceConnection: function(appName, instanceId, url, apiKey) {
        if (window.HuntarrInstances) {
            window.HuntarrInstances.testInstanceConnection(appName, instanceId, url, apiKey);
        }
    },
    
    // Helper function to translate HTTP error codes to user-friendly messages
    getConnectionErrorMessage: function(status) {
        return window.HuntarrInstances ? window.HuntarrInstances.getConnectionErrorMessage(status) : `Error ${status}`;
    },
    
    // App connections
    checkAppConnections: function() {
        if (window.HuntarrStats) {
            window.HuntarrStats.checkAppConnections();
        }
    },
    
    checkAppConnection: function(app) {
        if (window.HuntarrStats) {
            return window.HuntarrStats.checkAppConnection(app);
        }
        return Promise.resolve();
    },
    
    updateConnectionStatus: function(app, statusData) {
        if (window.HuntarrStats) {
            window.HuntarrStats.updateConnectionStatus(app, statusData);
        }
    },
    
    // Centralized function to update empty state visibility based on all configured apps
    updateEmptyStateVisibility: function() {
        if (window.HuntarrStats) {
            window.HuntarrStats.updateEmptyStateVisibility();
        }
    },

    // Load and update Swaparr status card
    loadSwaparrStatus: function() {
        // Delegate to Swaparr module
        if (window.HuntarrSwaparr) {
            window.HuntarrSwaparr.loadSwaparrStatus();
        }
    },

    // Setup Swaparr Reset buttons
    setupSwaparrResetCycle: function() {
        // Delegate to Swaparr module
        if (window.HuntarrSwaparr) {
            window.HuntarrSwaparr.setupSwaparrResetCycle();
        }
    },

    // Reset Swaparr data function
    resetSwaparrData: function() {
        // Delegate to Swaparr module
        if (window.HuntarrSwaparr) {
            window.HuntarrSwaparr.resetSwaparrData();
        }
    },

    // Update Swaparr stats display with animation
    updateSwaparrStatsDisplay: function(stats) {
        // Delegate to Swaparr module
        if (window.HuntarrSwaparr) {
            window.HuntarrSwaparr.updateSwaparrStatsDisplay(stats);
        }
    },

    // Setup Swaparr status polling
    setupSwaparrStatusPolling: function() {
        // Delegate to Swaparr module
        if (window.HuntarrSwaparr) {
            window.HuntarrSwaparr.setupSwaparrStatusPolling();
        }
    },

    // Prowlarr delegates — implementations in modules/features/prowlarr.js
    loadProwlarrStatus: function() { if (window.HuntarrProwlarr) window.HuntarrProwlarr.loadProwlarrStatus(); },
    loadProwlarrIndexers: function() { if (window.HuntarrProwlarr) window.HuntarrProwlarr.loadProwlarrIndexers(); },
    loadProwlarrStats: function() { if (window.HuntarrProwlarr) window.HuntarrProwlarr.loadProwlarrStats(); },
    updateIndexersList: function(d, e) { if (window.HuntarrProwlarr) window.HuntarrProwlarr.updateIndexersList(d, e); },
    updateProwlarrStatistics: function(s, e) { if (window.HuntarrProwlarr) window.HuntarrProwlarr.updateProwlarrStatistics(s, e); },
    showIndexerStats: function(n) { if (window.HuntarrProwlarr) window.HuntarrProwlarr.showIndexerStats(n); },
    showOverallStats: function() { if (window.HuntarrProwlarr) window.HuntarrProwlarr.showOverallStats(); },

    
    // User
    loadUsername: function() {
        if (window.HuntarrVersion) {
            window.HuntarrVersion.loadUsername();
        }
    },
    
    // Check if local access bypass is enabled and update UI accordingly
    checkLocalAccessBypassStatus: function() {
        if (window.HuntarrAuth) {
            window.HuntarrAuth.checkLocalAccessBypassStatus();
        }
    },
    
    updateUIForLocalAccessBypass: function(isEnabled) {
        if (window.HuntarrAuth) {
            window.HuntarrAuth.updateUIForLocalAccessBypass(isEnabled);
        }
    },
    
    logout: function(e) {
        if (window.HuntarrAuth) {
            window.HuntarrAuth.logout(e);
        }
    },
    
    // Media statistics handling
    loadMediaStats: function() {
        // Delegate to stats module
        if (window.HuntarrStats) {
            window.HuntarrStats.loadMediaStats();
        }
    },
    
    updateStatsDisplay: function(stats, isFromCache = false) {
        // Delegate to stats module
        if (window.HuntarrStats) {
            window.HuntarrStats.updateStatsDisplay(stats, isFromCache);
        }
    },

    // Helper function to parse formatted numbers back to integers
    parseFormattedNumber: function(formattedStr) {
        // Delegate to stats module
        return window.HuntarrStats ? window.HuntarrStats.parseFormattedNumber(formattedStr) : 0;
    },

    animateNumber: function(element, start, end) {
        // Delegate to stats module
        if (window.HuntarrStats) {
            window.HuntarrStats.animateNumber(element, start, end);
        }
    },
    
    // Format large numbers with appropriate suffixes (K, M, B, T)  
    formatLargeNumber: function(num) {
        // Delegate to stats module
        return window.HuntarrStats ? window.HuntarrStats.formatLargeNumber(num) : num.toString();
    },

    resetMediaStats: function(appType = null) {
        // Delegate to stats module
        if (window.HuntarrStats) {
            window.HuntarrStats.resetMediaStats(appType);
        }
    },
    
    // Utility functions
    showNotification: function(message, type) {
        // Delegate to notifications module
        if (window.HuntarrNotifications) {
            window.HuntarrNotifications.showNotification(message, type);
        }
    },
    
    capitalizeFirst: function(string) {
        // Delegate to helpers module
        return window.HuntarrHelpers ? window.HuntarrHelpers.capitalizeFirst(string) : string.charAt(0).toUpperCase() + string.slice(1);
    },

    // Load current version from version.txt
    // Load current version from version.txt
    loadCurrentVersion: function() {
        if (window.HuntarrVersion) {
            window.HuntarrVersion.loadCurrentVersion();
        }
    },

    // Load latest version from GitHub releases
    loadLatestVersion: function() {
        if (window.HuntarrVersion) {
            window.HuntarrVersion.loadLatestVersion();
        }
    },
    
    // Load latest beta version from GitHub tags
    loadBetaVersion: function() {
        if (window.HuntarrVersion) {
            window.HuntarrVersion.loadBetaVersion();
        }
    },

    // Load GitHub star count
    loadGitHubStarCount: function() {
        if (window.HuntarrVersion) {
            window.HuntarrVersion.loadGitHubStarCount();
        }
    },

    // Update home connection status
    updateHomeConnectionStatus: function() {
        console.log('[huntarrUI] Updating home connection statuses...');
        // This function should ideally call checkAppConnection for all relevant apps
        // or use the stored configuredApps status if checkAppConnection updates it.
        this.checkAppConnections(); // Re-check all connections after a save might be simplest
    },
    
    // Load stateful management info
    loadStatefulInfo: function(attempts = 0, skipCache = false) {
        if (window.HuntarrStateful) {
            window.HuntarrStateful.loadStatefulInfo(attempts, skipCache);
        }
    },
    
    // Format date nicely with time, day, and relative time indication
    formatDateNicely: function(date) {
        return window.HuntarrStateful ? window.HuntarrStateful.formatDateNicely(date) : date.toLocaleString();
    },
    
    // Helper function to get the user's configured timezone from settings
    getUserTimezone: function() {
        return window.HuntarrHelpers ? window.HuntarrHelpers.getUserTimezone() : 'UTC';
    },
    
    // Reset stateful management - clear all processed IDs
    resetStatefulManagement: function() {
        if (window.HuntarrStateful) {
            window.HuntarrStateful.resetStatefulManagement();
        }
    },
    
    // Update stateful management expiration based on hours input
    updateStatefulExpirationOnUI: function() {
        const hoursInput = document.getElementById('stateful_management_hours');
        if (!hoursInput) return;
        
        const hours = parseInt(hoursInput.value) || 72;
        
        // Show updating indicator
        const expiresDateEl = document.getElementById('stateful_expires_date');
        const initialStateEl = document.getElementById('stateful_initial_state');
        
        if (expiresDateEl) {
            expiresDateEl.textContent = 'Updating...';
        }
        
        const url = './api/stateful/update-expiration';
        const cleanedUrl = this.cleanUrlString(url);
        
        HuntarrUtils.fetchWithTimeout(cleanedUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hours: hours }),
            cache: 'no-cache'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                console.log('[huntarrUI] Stateful expiration updated successfully:', data);
                
                // Get updated info to show proper dates
                this.loadStatefulInfo();
                
                // Show a notification
                this.showNotification(`Updated expiration to ${hours} hours (${(hours/24).toFixed(1)} days)`, 'success');
            } else {
                throw new Error(data.message || 'Unknown error updating expiration');
            }
        })
        .catch(error => {
             console.error('Error updating stateful expiration:', error);
             this.showNotification(`Failed to update expiration: ${error.message}`, 'error');
             // Reset the UI
             if (expiresDateEl) {
                 expiresDateEl.textContent = 'Error updating';
             }
             
             // Try to reload original data
             setTimeout(() => this.loadStatefulInfo(), 1000);
        });
    },

    // Add the updateStatefulExpiration method
    updateStatefulExpiration: function(hours) {
        if (!hours || typeof hours !== 'number' || hours <= 0) {
            console.error('[huntarrUI] Invalid hours value for updateStatefulExpiration:', hours);
            return;
        }
        
        console.log(`[huntarrUI] Directly updating stateful expiration to ${hours} hours`);
        
        // Make a direct API call to update the stateful expiration
        HuntarrUtils.fetchWithTimeout('./api/stateful/update-expiration', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hours: hours })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('[huntarrUI] Stateful expiration updated successfully:', data);
            // Update the expiration date display
            const expiresDateEl = document.getElementById('stateful_expires_date');
            if (expiresDateEl && data.expires_date) {
                expiresDateEl.textContent = data.expires_date;
            }
        })
        .catch(error => {
            console.error('[huntarrUI] Error updating stateful expiration:', error);
        });
    },
    
    // Add global event handler and method to track saved settings across all apps
    // Auto-save enabled - unsaved changes handlers removed
    
    // Add a proper hasFormChanges function to compare form values with original values
    hasFormChanges: function(app) {
        // If we don't have original settings or current app settings, we can't compare
        if (!this.originalSettings || !this.originalSettings[app]) {
            return false;
        }
        
        // Get current settings from the form
        const currentSettings = this.getFormSettings(app);
        
        // For complex objects like instances, we need to stringify them for comparison
        const originalJSON = JSON.stringify(this.originalSettings[app]);
        const currentJSON = JSON.stringify(currentSettings);
        
        return originalJSON !== currentJSON;
    },
    
    // Check if Low Usage Mode is enabled in settings and apply it
    checkLowUsageMode: function() {
        return window.HuntarrTheme ? window.HuntarrTheme.checkLowUsageMode() : Promise.resolve();
    },
    
    // Apply Low Usage Mode effects based on setting
    applyLowUsageMode: function(enabled) {
        if (window.HuntarrTheme) {
            window.HuntarrTheme.applyLowUsageMode(enabled);
        }
    },

    // Apply timezone change immediately
    applyTimezoneChange: function(timezone) {
        if (window.HuntarrSettings && typeof window.HuntarrSettings.applyTimezoneChange === 'function') {
            window.HuntarrSettings.applyTimezoneChange(timezone);
        }
    },

    // Apply authentication mode change immediately
    applyAuthModeChange: function(authMode) {
        if (window.HuntarrSettings && typeof window.HuntarrSettings.applyAuthModeChange === 'function') {
            window.HuntarrSettings.applyAuthModeChange(authMode);
        }
    },

    // Apply update checking change immediately
    applyUpdateCheckingChange: function(enabled) {
        if (window.HuntarrSettings && typeof window.HuntarrSettings.applyUpdateCheckingChange === 'function') {
            window.HuntarrSettings.applyUpdateCheckingChange(enabled);
        }
    },

    applyShowTrendingChange: function(enabled) {
        if (window.HuntarrSettings && typeof window.HuntarrSettings.applyShowTrendingChange === 'function') {
            window.HuntarrSettings.applyShowTrendingChange(enabled);
        }
    },

    // Refresh time displays after timezone change
    refreshTimeDisplays: function() {
        if (window.HuntarrStateful) {
            window.HuntarrStateful.refreshTimeDisplays();
        }
    },
    
    // Reset the app cycle for a specific app
    resetAppCycle: function(app, button) {
        // Make sure we have the app and button elements
        if (!app || !button) {
            console.error('[huntarrUI] Missing app or button for resetAppCycle');
            return;
        }
        
        // First, disable the button to prevent multiple clicks
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Resetting...';
        
        // Per-instance reset for *arr apps (card has data-instance-name)
        const instanceName = button.getAttribute('data-instance-name');
        let endpoint = `./api/cycle/reset/${app}`;
        if (instanceName && app !== 'swaparr') {
            endpoint += '?instance_name=' + encodeURIComponent(instanceName);
        }
        
        HuntarrUtils.fetchWithTimeout(endpoint, {
            method: 'POST'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to reset ${app} cycle`);
            }
            return response.json();
        })
        .then(data => {
            this.showNotification(`Successfully reset ${this.capitalizeFirst(app)} cycle`, 'success');
            console.log(`[huntarrUI] Reset ${app} cycle response:`, data);
            
            // Re-enable the button with original text
            button.disabled = false;
            button.innerHTML = `<i class="fas fa-sync-alt"></i> Reset`;
        })
        .catch(error => {
            console.error(`[huntarrUI] Error resetting ${app} cycle:`, error);
            this.showNotification(`Error resetting ${this.capitalizeFirst(app)} cycle: ${error.message}`, 'error');
            
            // Re-enable the button with original text
            button.disabled = false;
            button.innerHTML = `<i class="fas fa-sync-alt"></i> Reset`;
        });
    },

    // More robust low usage mode detection
    isLowUsageModeEnabled: function() {
        // Check multiple sources to determine if low usage mode is enabled
        
        // 1. Check CSS class on body (primary method)
        const hasLowUsageClass = document.body.classList.contains('low-usage-mode');
        
        // 2. Check if the standalone low-usage-mode.js module is enabled
        const standaloneModuleEnabled = window.LowUsageMode && window.LowUsageMode.isEnabled && window.LowUsageMode.isEnabled();
        
        // 3. Final determination based on reliable sources (no indicator checking needed)
        const isEnabled = hasLowUsageClass || standaloneModuleEnabled;
        
        console.log(`[huntarrUI] Low usage mode detection - CSS class: ${hasLowUsageClass}, Module: ${standaloneModuleEnabled}, Final: ${isEnabled}`);
        
        return isEnabled;
    },

    showDashboard: function() {
        if (window.HuntarrDOM) {
            window.HuntarrDOM.showDashboard();
        }
    },

    applyFilterToSingleEntry: function(logEntry, selectedLevel) {
        if (window.HuntarrLogs) {
            window.HuntarrLogs.applyFilterToSingleEntry(logEntry, selectedLevel);
        }
    },

    filterLogsByLevel: function(selectedLevel) {
        if (window.HuntarrLogs) {
            window.HuntarrLogs.filterLogsByLevel(selectedLevel);
        }
    },
    
    // Helper method to detect JSON fragments that shouldn't be displayed as log entries
    isJsonFragment: function(logString) {
        if (!logString || typeof logString !== 'string') return false;
        
        const trimmed = logString.trim();
        
        // Check for common JSON fragment patterns
        const jsonPatterns = [
            /^"[^"]*":\s*"[^"]*",?$/,           // "key": "value",
            /^"[^"]*":\s*\d+,?$/,                // "key": 123,
            /^"[^"]*":\s*true|false,?$/,         // "key": true,
            /^"[^"]*":\s*null,?$/,               // "key": null,
            /^"[^"]*":\s*\[[^\]]*\],?$/,         // "key": [...],
            /^"[^"]*":\s*\{[^}]*\},?$/,          // "key": {...},
            /^\s*\{?\s*$/,                       // Just opening brace or whitespace
            /^\s*\}?,?\s*$/,                     // Just closing brace
            /^\s*\[?\s*$/,                       // Just opening bracket
            /^\s*\]?,?\s*$/,                     // Just closing bracket
            /^,?\s*$/,                           // Just comma or whitespace
            /^[^"]*':\s*[^,]*,.*':/,          // Mid-object fragments like "g_items': 1, 'hunt_upgrade_items': 0"
            /^[a-zA-Z_][a-zA-Z0-9_]*':\s*\d+,/,  // Property names starting without quotes
            /^[a-zA-Z_][a-zA-Z0-9_]*':\s*True|False,/, // Boolean properties without opening quotes
            /^[a-zA-Z_][a-zA-Z0-9_]*':\s*'[^']*',/, // String properties without opening quotes
            /.*':\s*\d+,.*':\s*\d+,/,            // Multiple numeric properties in sequence
            /.*':\s*True,.*':\s*False,/,         // Multiple boolean properties in sequence
            /.*':\s*'[^']*',.*':\s*'[^']*',/,    // Multiple string properties in sequence
            /^"[^"]*":\s*\[$/,                   // JSON key with opening bracket: "global": [
            /^[a-zA-Z_][a-zA-Z0-9_\s]*:\s*\[$/,  // Property key with opening bracket: global: [
            /^[a-zA-Z_][a-zA-Z0-9_\s]*:\s*\{$/,  // Property key with opening brace: config: {
            /^[a-zA-Z_]+\s+(Mode|Setting|Config|Option):\s*(True|False|\d+)$/i, // Config fragments: "ug Mode: False"
            /^[a-zA-Z_]+\s*Mode:\s*(True|False)$/i, // Mode fragments: "Debug Mode: False"
            /^[a-zA-Z_]+\s*Setting:\s*.*$/i,     // Setting fragments
            /^[a-zA-Z_]+\s*Config:\s*.*$/i       // Config fragments
        ];
        
        return jsonPatterns.some(pattern => pattern.test(trimmed));
    },
    
    // Helper method to detect other invalid log lines
    isInvalidLogLine: function(logString) {
        if (!logString || typeof logString !== 'string') return true;
        
        const trimmed = logString.trim();
        
        // Skip empty lines or lines with only whitespace
        if (trimmed.length === 0) return true;
        
        // Skip lines that are clearly not log entries
        if (trimmed.length < 10) return true; // Too short to be a meaningful log
        
        // Skip lines that look like HTTP headers or other metadata
        if (/^(HTTP\/|Content-|Connection:|Host:|User-Agent:)/i.test(trimmed)) return true;
        
        // Skip partial words or fragments that don't form complete sentences
        if (/^[a-zA-Z]{1,5}\s+(Mode|Setting|Config|Debug|Info|Error|Warning):/i.test(trimmed)) return true;
        
        // Skip single words that are clearly fragments
        if (/^[a-zA-Z]{1,8}$/i.test(trimmed)) return true;
        
        // Skip lines that start with partial words and contain colons (config fragments)
        if (/^[a-z]{1,8}\s*[A-Z]/i.test(trimmed) && trimmed.includes(':')) return true;
        
        return false;
    },
    
    // Load instance-specific state management information
    loadInstanceStateInfo: function(appType, instanceIndex) {
        if (window.HuntarrStateful) {
            window.HuntarrStateful.loadInstanceStateInfo(appType, instanceIndex);
        }
    },
    
    // Update the instance state management display
    updateInstanceStateDisplay: function(appType, instanceIndex, summaryData, instanceName, customHours) {
        if (window.HuntarrStateful) {
            window.HuntarrStateful.updateInstanceStateDisplay(appType, instanceIndex, summaryData, instanceName, customHours);
        }
    },

    // Refresh state management timezone displays when timezone changes
    refreshStateManagementTimezone: function() {
        if (window.HuntarrStateful) {
            window.HuntarrStateful.refreshStateManagementTimezone();
        }
    },

    // Reload state management displays after timezone change
    reloadStateManagementDisplays: function() {
        if (window.HuntarrStateful) {
            window.HuntarrStateful.reloadStateManagementDisplays();
        }
    },

    // Load state management data for a specific instance
    loadStateManagementForInstance: function(appType, instanceIndex, instanceName) {
        if (window.HuntarrStateful) {
            window.HuntarrStateful.loadStateManagementForInstance(appType, instanceIndex, instanceName);
        }
    },

    updateRequestarrSidebarActive: function() {
        if (window.HuntarrRequestarr) {
            window.HuntarrRequestarr.updateRequestarrSidebarActive();
        }
    },

    updateRequestarrNavigation: function(view) {
        if (window.HuntarrRequestarr) {
            window.HuntarrRequestarr.updateRequestarrNavigation(view);
        }
    },

    setupRequestarrNavigation: function() {
        if (window.HuntarrRequestarr) {
            window.HuntarrRequestarr.setupRequestarrNavigation();
        }
    },

    setupMovieHuntNavigation: function() {
        if (window.HuntarrNavigation && window.HuntarrNavigation.setupMovieHuntNavigation) {
            window.HuntarrNavigation.setupMovieHuntNavigation();
        }
    },

    updateAppsSidebarActive: function() {
        if (window.HuntarrNavigation) {
            window.HuntarrNavigation.updateAppsSidebarActive();
        }
    },

    updateSettingsSidebarActive: function() {
        if (window.HuntarrNavigation) {
            window.HuntarrNavigation.updateSettingsSidebarActive();
        }
    },

    setupAppsNavigation: function() {
        if (window.HuntarrNavigation) {
            window.HuntarrNavigation.setupAppsNavigation();
        }
    },

    setupSettingsNavigation: function() {
        if (window.HuntarrNavigation) {
            window.HuntarrNavigation.setupSettingsNavigation();
        }
    },

    setupSystemNavigation: function() {
        if (window.HuntarrNavigation && window.HuntarrNavigation.setupSystemTabs) {
            window.HuntarrNavigation.setupSystemTabs();
        }
    },

    initializeLogsSettings: function() {
        if (window.HuntarrInit) {
            window.HuntarrInit.initializeLogsSettings();
        }
    },

    initializeSettings: function() {
        if (window.HuntarrInit) {
            window.HuntarrInit.initializeSettings();
        }
    },

    initializeNotifications: function() {
        if (window.HuntarrInit) {
            window.HuntarrInit.initializeNotifications();
        }
    },

    initializeBackupRestore: function() {
        if (window.HuntarrInit) {
            window.HuntarrInit.initializeBackupRestore();
        }
    },

    initializeProwlarr: function() {
        if (window.HuntarrInit) {
            window.HuntarrInit.initializeProwlarr();
        }
    },

    initializeUser: function() {
        if (window.HuntarrInit) {
            window.HuntarrInit.initializeUser();
        }
    },

    initializeSwaparr: function() {
        if (window.HuntarrInit) {
            window.HuntarrInit.initializeSwaparr();
        }
    },

    loadSwaparrApps: function() {
        if (window.HuntarrSwaparr) {
            window.HuntarrSwaparr.loadSwaparrApps();
        }
    },

    setupProwlarrStatusPolling: function() { if (window.HuntarrProwlarr) window.HuntarrProwlarr.setupProwlarrStatusPolling(); },


};

// Note: redirectToSwaparr function removed - Swaparr now has its own dedicated section

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize TMDB image cache first
    if (typeof tmdbImageCache !== 'undefined') {
        tmdbImageCache.init().catch(error => {
            console.error('[app.js] Failed to initialize TMDB image cache:', error);
        });
    }
    
    huntarrUI.init();
    
    // Initialize our enhanced UI features
    if (typeof StatsTooltips !== 'undefined') {
        StatsTooltips.init();
    }
    
    if (typeof CardHoverEffects !== 'undefined') {
        CardHoverEffects.init();
    }
    
    if (typeof CircularProgress !== 'undefined') {
        CircularProgress.init();
    }
    
    if (typeof BackgroundPattern !== 'undefined') {
        BackgroundPattern.init();
    }
    
    // Initialize per-instance reset button listeners
    if (typeof SettingsForms !== 'undefined' && typeof SettingsForms.setupInstanceResetListeners === 'function') {
        SettingsForms.setupInstanceResetListeners();
    }
    
    // Initialize UserModule when available
    if (typeof UserModule !== 'undefined') {
        console.log('[huntarrUI] UserModule available, initializing...');
        window.userModule = new UserModule();
    }
});

// Expose huntarrUI to the global scope for access by app modules
window.huntarrUI = huntarrUI;

// Expose state management timezone refresh function globally for settings forms
window.refreshStateManagementTimezone = function() {
    if (window.huntarrUI && typeof window.huntarrUI.refreshStateManagementTimezone === 'function') {
        window.huntarrUI.refreshStateManagementTimezone();
    } else {
        console.warn('[huntarrUI] refreshStateManagementTimezone function not available');
    }
};
