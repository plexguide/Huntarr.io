/**
 * Huntarr - Core Application Orchestrator
 * Main entry point for the Huntarr UI.
 * Coordinates between modular components and handles global application state.
 */

function _checkLogsMediaHuntInstances(cb) {
    Promise.all([
        fetch('./api/movie-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
        fetch('./api/tv-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
        fetch('./api/indexer-hunt/indexers', { cache: 'no-store' }).then(function(r) { return r.json(); }),
        fetch('./api/movie-hunt/has-clients', { cache: 'no-store' }).then(function(r) { return r.json(); })
    ]).then(function(results) {
        var movieCount = (results[0].instances || []).length;
        var tvCount = (results[1].instances || []).length;
        var indexerCount = (results[2].indexers || []).length;
        var hasClients = results[3].has_clients === true;
        var hasInstances = movieCount > 0 || tvCount > 0;
        if (!hasInstances) {
            cb('no-instances');
        } else if (indexerCount === 0) {
            cb('no-indexers');
        } else if (!hasClients) {
            cb('no-clients');
        } else {
            cb('ok');
        }
    }).catch(function() { cb('no-instances'); });
}

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

        this._enableRequestarr = true;
        this._enableNzbHunt = true;
        this._enableMediaHunt = true;
        this._enableThirdPartyApps = true;
        this._settingsLoaded = false;
        fetch('./api/settings')
            .then(r => r.json())
            .then(all => {
                var generalSettings = (all && all.general) || {};
                this._enableRequestarr = generalSettings.enable_requestarr !== false;
                this._enableNzbHunt = true;
                this._enableMediaHunt = generalSettings.enable_media_hunt !== false;
                this._enableThirdPartyApps = generalSettings.enable_third_party_apps !== false;
                this._settingsLoaded = true;
                // Update sidebar group visibility from database settings (nav-group-* IDs)
                // IMPORTANT: Skip this for non-owner users — they are fully siloed
                var isNonOwner = document.body.classList.contains('non-owner-mode');
                if (!isNonOwner) {
                    var requestsGroup = document.getElementById('nav-group-requests');
                    var mediaHuntGroup = document.getElementById('nav-group-media-hunt');
                    var nzbHuntGroup = document.getElementById('nzb-hunt-sidebar-group');
                    var appsGroup = document.getElementById('nav-group-apps');
                    var appsLabel = document.getElementById('nav-group-apps-label');
                    if (requestsGroup) requestsGroup.style.display = (generalSettings.enable_requestarr === false) ? 'none' : '';
                    if (mediaHuntGroup) mediaHuntGroup.style.display = (generalSettings.enable_media_hunt === false) ? 'none' : '';
                    if (nzbHuntGroup) nzbHuntGroup.style.display = (generalSettings.enable_media_hunt === false) ? 'none' : '';
                    if (appsGroup) appsGroup.style.display = (generalSettings.enable_third_party_apps === false) ? 'none' : '';
                    if (appsLabel) appsLabel.style.display = (generalSettings.enable_media_hunt === false && generalSettings.enable_third_party_apps === false) ? 'none' : '';
                }
                if (typeof window.applyFeatureFlags === 'function') window.applyFeatureFlags();
                
                // Initialize originalSettings early
                this.originalSettings = all || {};
                this.originalSettings.general = all.general || { ui_preferences: {} };
                if (!this.originalSettings.general.ui_preferences) this.originalSettings.general.ui_preferences = {};
                
                this.updateMovieHuntNavVisibility();

                // NOW initialize UI preferences that depend on settings
                if (window.HuntarrTheme) {
                    window.HuntarrTheme.initDarkMode();
                }
                this.logoUrl = HuntarrUtils.getUIPreference('logo-url', this.logoUrl);
                if (typeof window.applyLogoToAllElements === 'function') {
                    window.applyLogoToAllElements();
                }

                // Settings are now loaded — re-initialize view toggle with correct preference
                if (window.HuntarrStats && (this.currentSection === 'home' || !this.currentSection)) {
                    window.HuntarrStats.initViewToggle();
                    window.HuntarrStats.loadMediaStats(true);
                }
                if ((this.currentSection === 'home' || !this.currentSection) && window.HuntarrIndexerHuntHome && typeof window.HuntarrIndexerHuntHome.setup === 'function') {
                    window.HuntarrIndexerHuntHome.setup();
                }

                // Settings are loaded — now safe to check welcome preference
                if (this.currentSection === 'home' || !this.currentSection) {
                    this._maybeShowWelcome();
                }
            })
            .catch(() => {});
        
        // Register event handlers
        this.setupEventListeners();
        this.setupLogoHandling();
        // Auto-save enabled - no unsaved changes handler needed
        
        // NOTE: loadMediaStats() + initViewToggle() + startPolling() are called
        // by switchSection('home') via handleHashNavigation below — no need to duplicate here.
        
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
            console.log('[huntarrUI] Initialization - showing settings group');
            this.showSettingsSidebar();
        } else if (this.currentSection === 'system' || this.currentSection === 'hunt-manager' || this.currentSection === 'logs') {
            console.log('[huntarrUI] Initialization - showing system group');
            this.showMainSidebar();
        } else if (this.currentSection === 'nzb-hunt-home' || this.currentSection === 'nzb-hunt-activity' || this.currentSection === 'nzb-hunt-server-editor' || this.currentSection === 'nzb-hunt-folders' || this.currentSection === 'nzb-hunt-servers' || this.currentSection === 'nzb-hunt-advanced' || (this.currentSection && this.currentSection.startsWith('nzb-hunt-settings'))) {
            console.log('[huntarrUI] Initialization - showing NZB Hunt sidebar');
            this.showNzbHuntSidebar();
        } else if (this.currentSection === 'indexer-hunt' || this.currentSection === 'indexer-hunt-stats' || this.currentSection === 'indexer-hunt-history') {
            console.log('[huntarrUI] Initialization - showing Media Config sidebar for Index Master');
            this.showMovieHuntSidebar();
        } else if ((this.currentSection && this.currentSection.startsWith('tv-hunt')) || this.currentSection === 'logs-tv-hunt') {
            console.log('[huntarrUI] Initialization - showing media hunt sidebar (tv-hunt redirect)');
            this.showMovieHuntSidebar();
        } else if (this.currentSection === 'media-hunt-settings' || this.currentSection === 'media-hunt-instances' || this.currentSection === 'settings-instance-management' || this.currentSection === 'settings-media-management' || this.currentSection === 'settings-profiles' || this.currentSection === 'settings-sizes' || this.currentSection === 'profile-editor' || this.currentSection === 'settings-custom-formats' || this.currentSection === 'settings-indexers' || this.currentSection === 'settings-import-media' || this.currentSection === 'settings-import-lists' || this.currentSection === 'settings-root-folders') {
            console.log('[huntarrUI] Initialization - showing movie hunt sidebar (config)');
            this.showMovieHuntSidebar();
        } else if (this.currentSection === 'movie-hunt-home' || this.currentSection === 'movie-hunt-collection' || this.currentSection === 'media-hunt-collection' || this.currentSection === 'activity-queue' || this.currentSection === 'activity-history' || this.currentSection === 'activity-blocklist' || this.currentSection === 'activity-logs' || this.currentSection === 'logs-media-hunt' || this.currentSection === 'settings-clients' || this.currentSection === 'movie-hunt-instance-editor') {
            console.log('[huntarrUI] Initialization - showing movie hunt sidebar');
            this.showMovieHuntSidebar();
        } else if (this.currentSection === 'requestarr' || this.currentSection === 'requestarr-discover' || this.currentSection === 'requestarr-movies' || this.currentSection === 'requestarr-tv' || this.currentSection === 'requestarr-smarthunt' || this.currentSection === 'requestarr-hidden' || this.currentSection === 'requestarr-personal-blacklist' || this.currentSection === 'requestarr-filters' || this.currentSection === 'requestarr-settings' || this.currentSection === 'requestarr-smarthunt-settings' || this.currentSection === 'requestarr-users' || this.currentSection === 'requestarr-bundles' || this.currentSection === 'requestarr-requests' || this.currentSection === 'requestarr-global-blacklist') {
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
            // Default: show main sidebar (Home)
            console.log('[huntarrUI] Initialization - showing main sidebar (default)');
            this.showMainSidebar();
        }
        
        // Auto-save enabled - no unsaved changes handler needed
        
        // Load username
        this.loadUsername();
        
        // Preload stateful management info so it's ready when needed
        this.loadStatefulInfo();
        
        // Load current version
        this.loadCurrentVersion();
        // Load latest version from GitHub
        this.loadLatestVersion();
        // Load latest beta version from GitHub
        this.loadBetaVersion();
        // Load GitHub star count
        this.loadGitHubStarCount();
        
        // Initialize instance event handlers
        this.setupInstanceEventHandlers();
        
        // Setup navigation for sidebars
        this.setupRequestarrNavigation();
        this.setupMovieHuntNavigation();
        this.setupTVHuntNavigation();
        this.setupNzbHuntNavigation();
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
        
        // Setup Indexer Hunt home card — DEFERRED until feature flags are loaded
        // (setupIndexerHuntHome is called inside the settings .then() callback to avoid
        //  a race where _enableMediaHunt is still true when the card renders)
        
        // Fetch current user role and apply UI restrictions for non-admin users
        this.applyRoleBasedUI();

        // Make dashboard visible after initialization to prevent FOUC
        setTimeout(() => {
            this.showDashboard();
            // Mark as initialized after everything is set up to enable refresh on section changes
            this.isInitialized = true;
            console.log('[huntarrUI] Initialization complete - refresh on section change enabled');
        }, 50); // Reduced from implicit longer delay
    },

    // ── Role-based UI stripping ──────────────────────────────
    _userRole: null,
    _userPermissions: null,

    applyRoleBasedUI: function() {
        fetch('./api/requestarr/users/me', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data || !data.user) return;
                this._userRole = data.user.role || 'owner';
                this._userPermissions = data.user.permissions || {};
                window._huntarrUserRole = this._userRole;
                window._huntarrUserPermissions = this._userPermissions;
                console.log('[huntarrUI] User role:', this._userRole);

                if (this._userRole === 'owner') {
                    // Owner sees everything — just load badge
                    this._updatePendingRequestBadge();
                    if (!this._pendingBadgeInterval) {
                        this._pendingBadgeInterval = setInterval(() => this._updatePendingRequestBadge(), 60000);
                    }
                } else {
                    // Non-owner users: siloed to Requests only
                    this._applyNonOwnerRestrictions();
                }
            })
            .catch(e => {
                console.debug('[huntarrUI] Could not fetch user role:', e);
            });
    },

    _updatePendingRequestBadge: function() {
        fetch('./api/requestarr/requests/pending-count', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                var badge = document.getElementById('requestarr-pending-badge');
                var mirrors = document.querySelectorAll('.requestarr-pending-badge-mirror');
                var count = (data && data.count) || 0;
                var text = count > 99 ? '99+' : String(count);
                var show = count > 0;
                if (badge) {
                    badge.textContent = text;
                    badge.style.display = show ? '' : 'none';
                }
                mirrors.forEach(function(m) {
                    m.textContent = text;
                    m.style.display = show ? '' : 'none';
                });
            })
            .catch(function() {});
    },

    /**
     * Non-owner users get a completely separate sidebar.
     * We nuke the owner nav-menu and build a clean standalone one.
     */
    _applyNonOwnerRestrictions: function() {
        // 1. Mark body so CSS rules apply
        document.body.classList.add('non-owner-mode');

        // 2. Replace the entire nav-menu with a standalone non-owner sidebar
        var navMenu = document.querySelector('#sidebar .nav-menu');
        if (navMenu && !document.getElementById('non-owner-nav')) {
            // Grab the Daughter's Sponsors data before we nuke the menu
            var sponsorNav = document.getElementById('sidebar-partner-projects-nav');
            var sponsorHref = sponsorNav ? sponsorNav.getAttribute('href') : '#';
            var sponsorTarget = sponsorNav ? sponsorNav.getAttribute('target') : '_blank';
            var sponsorNameEl = document.getElementById('sidebar-partner-projects-name');
            var sponsorName = sponsorNameEl ? sponsorNameEl.textContent : 'Loading...';

            // Build the non-owner nav
            var nav = document.createElement('nav');
            nav.className = 'nav-menu';
            nav.id = 'non-owner-nav';

            var items = [
                { id: 'requestarrDiscoverNav', hash: '#requestarr-discover', icon: 'fas fa-compass', label: 'Discover' },
                { id: 'requestarrTVNav', hash: '#requestarr-tv', icon: 'fas fa-tv', label: 'TV Shows' },
                { id: 'requestarrMoviesNav', hash: '#requestarr-movies', icon: 'fas fa-film', label: 'Movies' },
                { id: 'requestarrSmartHuntNav', hash: '#requestarr-smarthunt', icon: 'fas fa-fire', label: 'Smart Hunt' },
                { id: 'requestarrPersonalBlacklistNav', hash: '#requestarr-personal-blacklist', icon: 'fas fa-eye-slash', label: 'Personal Blacklist' },
                { id: 'requestarrRequestsNav', hash: '#requestarr-requests', icon: 'fas fa-inbox', label: 'Requests' }
            ];

            // Section label
            nav.innerHTML = '<div class="nav-group"><div class="nav-group-title">Request System</div></div>';

            // Nav items — all same level, same style
            items.forEach(function(item) {
                var a = document.createElement('a');
                a.href = './' + item.hash;
                a.className = 'nav-item non-owner-nav-item';
                a.id = item.id;
                a.innerHTML = '<div class="nav-icon-wrapper"><i class="' + item.icon + '"></i></div><span>' + item.label + '</span>';
                nav.appendChild(a);
            });

            // Daughter's Sponsors — always visible
            var sponsorGroup = document.createElement('div');
            sponsorGroup.className = 'nav-group';
            sponsorGroup.id = 'main-sidebar-partner-projects-group';
            sponsorGroup.innerHTML =
                '<div class="nav-group-title">Daughter\'s Sponsors</div>' +
                '<a href="' + sponsorHref + '" target="' + sponsorTarget + '" rel="noopener noreferrer" class="nav-item" id="sidebar-partner-projects-nav">' +
                    '<div class="nav-icon-wrapper"><i class="fas fa-heart" style="color: #ec4899;"></i></div>' +
                    '<span id="sidebar-partner-projects-name">' + sponsorName + '</span>' +
                '</a>';
            nav.appendChild(sponsorGroup);

            navMenu.parentNode.replaceChild(nav, navMenu);

            // Set up active highlighting for the non-owner nav
            function setNonOwnerActive() {
                var h = window.location.hash || '#requestarr-discover';
                nav.querySelectorAll('.non-owner-nav-item').forEach(function(el) { el.classList.remove('active'); });
                var map = {
                    '#requestarr-discover': 'requestarrDiscoverNav',
                    '#requestarr': 'requestarrDiscoverNav',
                    '#requestarr-tv': 'requestarrTVNav',
                    '#requestarr-movies': 'requestarrMoviesNav',
                    '#requestarr-smarthunt': 'requestarrSmartHuntNav',
                    '#requestarr-hidden': 'requestarrPersonalBlacklistNav',
                    '#requestarr-personal-blacklist': 'requestarrPersonalBlacklistNav',
                    '#requestarr-requests': 'requestarrRequestsNav'
                };
                var targetId = map[h];
                if (targetId) {
                    var el = document.getElementById(targetId);
                    if (el) el.classList.add('active');
                }
            }
            window.addEventListener('hashchange', setNonOwnerActive);
            setNonOwnerActive();
        }

        // 3. Redirect if current section is not allowed
        var allowedSections = [
            'requestarr', 'requestarr-discover', 'requestarr-movies',
            'requestarr-tv', 'requestarr-smarthunt', 'requestarr-hidden',
            'requestarr-personal-blacklist', 'requestarr-requests',
        ];
        if (allowedSections.indexOf(this.currentSection) === -1) {
            window.location.hash = '#requestarr-discover';
        }

        // 4. Hide the Requests header bar (breadcrumb) — redundant for non-owner users
        var headerBar = document.querySelector('.requestarr-header-bar');
        if (headerBar) headerBar.style.display = 'none';
    },

    isAdminOnlySection: function(section) {
        if (this._userRole === 'owner') return false;
        if (!this._userRole) return false; // not loaded yet, don't block
        // All non-owner users are siloed to these sections only
        var allowed = [
            'requestarr', 'requestarr-discover', 'requestarr-movies',
            'requestarr-tv', 'requestarr-smarthunt', 'requestarr-hidden',
            'requestarr-personal-blacklist', 'requestarr-requests',
        ];
        return allowed.indexOf(section) === -1;
    },

    runWhenRequestarrReady: function(actionName, callback) {
        if (window.HuntarrRequestarr && typeof window.HuntarrRequestarr.runWhenRequestarrReady === 'function') {
            window.HuntarrRequestarr.runWhenRequestarrReady(actionName, callback);
            return;
        }
        // Requestarr bundle not loaded yet - wait for it before running callback
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (window.HuntarrRequestarr && typeof window.HuntarrRequestarr.runWhenRequestarrReady === 'function') {
                clearInterval(checkInterval);
                window.HuntarrRequestarr.runWhenRequestarrReady(actionName, callback);
                return;
            }
            if (Date.now() - startTime > 5000) {
                clearInterval(checkInterval);
                console.warn('[huntarrUI] HuntarrRequestarr not ready for ' + actionName + ' after 5s');
            }
        }, 50);
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
            // Sidebar: hash links use client-side navigation
            const sidebarNavItem = e.target.closest('#sidebar .nav-item');
            if (sidebarNavItem) {
                const link = sidebarNavItem.tagName === 'A' ? sidebarNavItem : sidebarNavItem.querySelector('a');
                const href = link && link.getAttribute('href');
                if (href && href.indexOf('#') >= 0) {
                    e.preventDefault();
                    const hash = href.substring(href.indexOf('#'));
                    const normalizedHash = (hash || '').replace(/^#+/, '');
                    if (window.location.hash !== hash) {
                        window.location.hash = hash;
                    } else if (normalizedHash === 'media-hunt-collection' && window.TVHuntCollection && typeof window.TVHuntCollection.showMainView === 'function') {
                        window.TVHuntCollection.showMainView();
                    }
                    if (typeof setActiveNavItem === 'function') setActiveNavItem();
                    return;
                }
            }

            // Navigation link handling (other nav areas)
            if (e.target.matches('.nav-link') || e.target.closest('.nav-link')) {
                const link = e.target.matches('.nav-link') ? e.target : e.target.closest('.nav-link');
                e.preventDefault();
                this.handleNavigation(e);
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
        
        // Requestarr, Movie Hunt, and TV Hunt navigation
        this.setupRequestarrNavigation();
        this.setupMovieHuntNavigation();
        this.setupTVHuntNavigation();
        
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
                var newHash = new URL(e.newURL).hash;
                // Revert navigation immediately
                history.pushState(null, null, e.oldURL);

                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({
                        title: 'Unsaved Changes',
                        message: 'You have unsaved changes that will be lost if you leave.',
                        confirmLabel: 'Go Back',
                        cancelLabel: 'Leave',
                        onConfirm: () => {
                            // Stay — navigation already reverted above, modal closes
                        },
                        onCancel: () => {
                            window._hasUnsavedChanges = false;
                            window.location.hash = newHash;
                        }
                    });
                } else {
                    if (!confirm('You have unsaved changes that will be lost. Leave anyway?')) {
                        return;
                    }
                    window._hasUnsavedChanges = false;
                    window.location.hash = newHash;
                }
                return;
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

        // NOTE: Initial hash navigation is handled in init() after setupEventListeners() returns.
        // Do NOT call handleHashNavigation here to avoid double-navigation on page load.

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
    
    // switchSection() extracted to app-sections.js (loaded after app.js in bundle-app.js)
    
    // ─── Sidebar switching (unified sidebar — expand groups) ───
    // With the unified sidebar, there's only one #sidebar element.
    // These functions now delegate to the sidebar.html inline expandSidebarGroup().

    _hideAllSidebars: function() {
        // No-op: only one sidebar now, always visible
    },

    showMainSidebar: function() {
        // Let setActiveNavItem handle group expansion based on hash
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    _maybeShowWelcome: function() {
        // Settings must be loaded before we can check preferences
        if (!window.huntarrUI || !window.huntarrUI.originalSettings || !window.huntarrUI.originalSettings.general) {
            return; // Settings not loaded yet — will be retried after settings load
        }
        // Check if already dismissed
        var dismissed = HuntarrUtils.getUIPreference('welcome-dismissed', false);
        if (dismissed) return;
        // Show the welcome modal
        var modal = document.getElementById('huntarr-welcome-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        // Wire up dismiss handlers (only once)
        if (!modal._welcomeWired) {
            modal._welcomeWired = true;
            var dismissBtn = document.getElementById('huntarr-welcome-dismiss');
            var closeBtn = document.getElementById('huntarr-welcome-close');
            var backdrop = document.getElementById('huntarr-welcome-backdrop');
            var dismiss = function() {
                modal.style.display = 'none';
                HuntarrUtils.setUIPreference('welcome-dismissed', true);
            };
            if (dismissBtn) dismissBtn.addEventListener('click', dismiss);
            if (closeBtn) closeBtn.addEventListener('click', dismiss);
            if (backdrop) backdrop.addEventListener('click', dismiss);
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') dismiss();
            });
        }
    },

    _updateMainSidebarBetaVisibility: function() {
        // Partner Projects always visible in unified sidebar
    },
    
    showAppsSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-apps');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },
    
    showSettingsSidebar: function() {
        // Settings now lives under System group
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-system');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },
    
    showRequestarrSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-requests');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showTVHuntSidebar: function() {
        this.showMovieHuntSidebar();
    },

    showMovieHuntSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-media-hunt');
        if (window.HuntarrNavigation && typeof window.HuntarrNavigation.updateMovieHuntSidebarActive === 'function') {
            window.HuntarrNavigation.updateMovieHuntSidebarActive();
        }
    },

    showNzbHuntSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-nzb-hunt');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    /** NZB Hunt sidebar is now always visible (controlled by applyFeatureFlags / enable_media_hunt).
     *  Kept as no-op for backward compatibility with callers. */
    _refreshNzbHuntSidebarGroup: function() {
        // No-op: sidebar visibility is handled by applyFeatureFlags()
    },

    /** Keep all Movie Hunt sidebar icons visible - no hiding when navigating between sections. */
    _updateMovieHuntSidebarSettingsOnlyVisibility: function() {
        // All navigation items remain visible for easier navigation
    },

    /** When in instance-editor for indexer/client, keep Index Master or Clients nav item highlighted. */
    _highlightMovieHuntNavForEditor: function(appType) {
        var subGroup = document.getElementById('index-master-sub');
        if (subGroup) subGroup.classList.add('expanded');
        // Query from unified sidebar
        var items = document.querySelectorAll('#sidebar-group-media-hunt .nav-item');
        for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
        var nav = appType === 'indexer' ? document.getElementById('movieHuntIndexMasterNav') : document.getElementById('movieHuntIndexMasterClientsNav');
        if (nav) nav.classList.add('active');
    },

    /** Legacy: was used to show/hide Movie Hunt in Core by dev_mode. Movie Hunt is now in Beta and always visible. */
    updateMovieHuntNavVisibility: function() {
        // No-op in unified sidebar
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

    setupTVHuntNavigation: function() {
        if (window.HuntarrNavigation && window.HuntarrNavigation.setupTVHuntNavigation) {
            window.HuntarrNavigation.setupTVHuntNavigation();
        }
    },

    setupNzbHuntNavigation: function() {
        if (window.HuntarrNavigation && window.HuntarrNavigation.setupNzbHuntNavigation) {
            window.HuntarrNavigation.setupNzbHuntNavigation();
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
    setupIndexerHuntHome: function() { if (window.HuntarrIndexerHuntHome) window.HuntarrIndexerHuntHome.setup(); },


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
    
    // Initialize UserModule when available (guard against duplicate construction)
    if (typeof UserModule !== 'undefined' && !window.userModule) {
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
