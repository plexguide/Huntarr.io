/**
 * App Sponsor Banner Rotation
 * Shows rotating Daughter's Sponsor on all app pages (Sonarr, Radarr, etc.)
 * Same functionality as home page sponsor banner.
 */

(function() {
    const APP_SPONSOR_CACHE_KEY = 'app_sponsor_cache';
    const CACHE_DURATION = 60 * 1000; // 1 minute - sponsor stays the same across pages
    const ROTATION_INTERVAL = 60 * 1000; // 1 minute rotation

    const PARTNER_PROJECTS_CACHE_KEY = 'home_partner_projects_cache';
    const PARTNER_PROJECTS = [
        { name: 'Cleanuparr', url: 'https://github.com/Cleanuparr/Cleanuparr' },
        { name: 'SeekandWatch', url: 'https://github.com/softerfish/seekandwatch' }
    ];
    const APP_TYPES = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'requestarr'];
    // Home + all app pages use the same sponsor rotation (same cache, same 1-min interval)
    const SPONSOR_SECTIONS = ['home', ...APP_TYPES];
    // Smart Hunt has its own banner row in toolbar
    const SMARTHUNT_APP_TYPE = 'requestarr-smarthunt';
    // Additional pages that show sponsor/partner banners (same rotation)
    const EXTRA_BANNER_SECTIONS = ['media-hunt', 'media-hunt-collection', 'apps', 'settings', 'system', 'movie-hunt', 'movie-hunt-settings', 'media-hunt-settings', 'media-hunt-instances', 'media-hunt-calendar', 'movie-hunt-instance-management', 'movie-hunt-instance-editor', 'swaparr', 'activity', 'nzb-hunt', 'nzb-hunt-activity', 'nzb-hunt-settings', 'nzb-hunt-server-editor', 'notifications', 'backup-restore', 'scheduling', 'user', 'instance-editor', 'profile-editor', 'movie-management', 'settings-media-management', 'media-management', 'settings-profiles', 'settings-sizes', 'settings-custom-formats', 'settings-indexers', 'settings-clients', 'settings-import-lists', 'settings-import-media', 'media-hunt-import-media', 'settings-root-folders', 'settings-logs', 'indexer-hunt', 'indexer-hunt-stats', 'indexer-hunt-history', 'tv-hunt', 'tv-hunt-instance-management', 'tv-hunt-instance-editor', 'tv-hunt-settings-tv-management', 'tv-hunt-settings-profiles', 'tv-hunt-settings-sizes', 'tv-hunt-settings-custom-formats', 'tv-hunt-settings-indexers', 'tv-hunt-settings-clients', 'tv-hunt-settings-import-lists', 'tv-hunt-settings-root-folders'];

    let rotationInterval = null;
    let sponsors = [];
    let currentIndex = 0;
    
    function updateSponsorBanner(sponsor, appType) {
        const sponsorName = document.getElementById(`${appType}-sponsor-name`);
        const sponsorBanner = document.getElementById(`${appType}-sponsor-banner`);
        
        if (sponsorName) sponsorName.textContent = sponsor.name;
        
        // Update href to sponsor's GitHub URL
        if (sponsorBanner && sponsor.url) {
            sponsorBanner.href = sponsor.url;
            sponsorBanner.setAttribute('data-sponsor-url', sponsor.url);
        }
    }
    
    function getRandomSponsor(sponsors) {
        if (!sponsors || sponsors.length === 0) return null;
        const randomIndex = Math.floor(Math.random() * sponsors.length);
        return sponsors[randomIndex];
    }
    
    function getNextSponsor() {
        if (!sponsors || sponsors.length === 0) return null;
        const sponsor = sponsors[currentIndex];
        currentIndex = (currentIndex + 1) % sponsors.length;
        return sponsor;
    }
    
    function getCachedSponsor() {
        try {
            const cached = localStorage.getItem(APP_SPONSOR_CACHE_KEY);
            if (!cached) return null;
            
            const { sponsor, timestamp } = JSON.parse(cached);
            const now = Date.now();
            
            // Check if cache is still valid (within 1 minute)
            if (now - timestamp < CACHE_DURATION) {
                return { sponsor, timestamp };
            }
            
            // Cache expired, remove it
            localStorage.removeItem(APP_SPONSOR_CACHE_KEY);
            return null;
        } catch (e) {
            console.error('Error reading app sponsor cache:', e);
            return null;
        }
    }
    
    function cacheSponsor(sponsor) {
        try {
            const cacheData = {
                sponsor: sponsor,
                timestamp: Date.now()
            };
            localStorage.setItem(APP_SPONSOR_CACHE_KEY, JSON.stringify(cacheData));
        } catch (e) {
            console.error('Error caching app sponsor:', e);
        }
    }
    
    function updateAllAppBanners(sponsor) {
        SPONSOR_SECTIONS.forEach(section => {
            updateSponsorBanner(sponsor, section);
        });
        updateSponsorBanner(sponsor, SMARTHUNT_APP_TYPE);
        EXTRA_BANNER_SECTIONS.forEach(section => {
            updateSponsorBanner(sponsor, section);
        });
    }

    // --- Partner Projects (sidebar nav, under Beta) - same 1-min rotation as sponsors ---
    function getCachedPartner() {
        try {
            const cached = localStorage.getItem(PARTNER_PROJECTS_CACHE_KEY);
            if (!cached) return null;
            const { project, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_DURATION) return project;
            localStorage.removeItem(PARTNER_PROJECTS_CACHE_KEY);
            return null;
        } catch (e) {
            return null;
        }
    }

    function cachePartner(project) {
        try {
            localStorage.setItem(PARTNER_PROJECTS_CACHE_KEY, JSON.stringify({ project, timestamp: Date.now() }));
        } catch (e) {}
    }

    function getRandomPartner() {
        if (!PARTNER_PROJECTS.length) return null;
        return PARTNER_PROJECTS[Math.floor(Math.random() * PARTNER_PROJECTS.length)];
    }

    let partnerCurrentIndex = 0;

    function updateSidebarPartnerNav(project) {
        const nameEl = document.getElementById('sidebar-partner-projects-name');
        const navEl = document.getElementById('sidebar-partner-projects-nav');
        if (nameEl) nameEl.textContent = project ? project.name : 'Loading...';
        if (navEl && project && project.url) {
            navEl.href = project.url;
        }
    }

    function doOnePartnerRotation() {
        const project = PARTNER_PROJECTS[partnerCurrentIndex];
        partnerCurrentIndex = (partnerCurrentIndex + 1) % PARTNER_PROJECTS.length;
        if (project) {
            updateSidebarPartnerNav(project);
            cachePartner(project);
        }
    }

    function loadPartnerProjects() {
        const cached = getCachedPartner();
        if (cached) {
            updateSidebarPartnerNav(cached);
            const idx = PARTNER_PROJECTS.findIndex(p => p.name === cached.name && p.url === cached.url);
            partnerCurrentIndex = idx >= 0 ? (idx + 1) % PARTNER_PROJECTS.length : 0;
        } else {
            const project = getRandomPartner();
            if (project) {
                updateSidebarPartnerNav(project);
                cachePartner(project);
                partnerCurrentIndex = (PARTNER_PROJECTS.findIndex(p => p.name === project.name) + 1) % PARTNER_PROJECTS.length;
            } else {
                updateSidebarPartnerNav({ name: '—', url: '#' });
            }
        }
        setInterval(doOnePartnerRotation, ROTATION_INTERVAL);
    }

    function doOneRotation() {
        const sponsor = getNextSponsor();
        if (sponsor) {
            updateAllAppBanners(sponsor);
            cacheSponsor(sponsor);
        }
    }

    function startRotation() {
        if (rotationInterval) {
            clearInterval(rotationInterval);
        }
        rotationInterval = setInterval(doOneRotation, ROTATION_INTERVAL);
    }
    
    const FALLBACK_SPONSORS = [
        { name: 'ElfHosted', url: 'https://github.com/elfhosted' },
        { name: 'simplytoast1', url: 'https://github.com/simplytoast1' },
        { name: 'TheOnlyLite', url: 'https://github.com/TheOnlyLite' },
        { name: 'tcconnally', url: 'https://github.com/tcconnally' },
        { name: 'StreamVault', url: 'https://github.com/streamvault' },
        { name: 'MediaServer Pro', url: 'https://github.com/mediaserverpro' },
        { name: 'NASGuru', url: 'https://github.com/nasguru' },
        { name: 'CloudCache', url: 'https://github.com/cloudcache' },
        { name: 'ServerSquad', url: 'https://github.com/serversquad' },
        { name: 'MediaMinder', url: 'https://github.com/mediaminder' },
        { name: 'StreamSage', url: 'https://github.com/streamsage' },
        { name: 'MediaStack', url: 'https://github.com/mediastack' }
    ];

    async function loadSponsors() {
        const cached = getCachedSponsor();
        
        if (cached) {
            // Keep showing cached sponsor for the full 1-minute window (no change on refresh/navigation)
            updateAllAppBanners(cached.sponsor);
            try {
                const response = await fetch('./api/github_sponsors');
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                sponsors = (data && data.length > 0) ? data : FALLBACK_SPONSORS;
                
                if (sponsors.length > 0) {
                    sponsors = sponsors.sort(() => Math.random() - 0.5);
                    const idx = sponsors.findIndex(s => s.name === cached.sponsor.name && s.url === cached.sponsor.url);
                    currentIndex = idx >= 0 ? (idx + 1) % sponsors.length : 0;
                    const delay = cached.timestamp + CACHE_DURATION - Date.now();
                    if (delay > 0) {
                        setTimeout(() => {
                            doOneRotation();
                            startRotation();
                        }, delay);
                    } else {
                        doOneRotation();
                        startRotation();
                    }
                } else {
                    startRotation();
                }
            } catch (e) {
                console.error('Error fetching app sponsors:', e);
                sponsors = FALLBACK_SPONSORS;
                startRotation();
            }
            return;
        }
        
        // No valid cache: fetch, show one, cache it, rotate every 1 minute
        try {
            const response = await fetch('./api/github_sponsors');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            sponsors = (data && data.length > 0) ? data : FALLBACK_SPONSORS;
            
            if (sponsors.length > 0) {
                sponsors = sponsors.sort(() => Math.random() - 0.5);
                currentIndex = 0;
                doOneRotation();
                startRotation();
            } else {
                updateAllAppBanners({ name: 'Be the first!', url: 'https://plexguide.github.io/Huntarr.io/donate.html' });
            }
        } catch (error) {
            console.error('Error fetching app sponsors:', error);
            sponsors = FALLBACK_SPONSORS;
            sponsors = sponsors.sort(() => Math.random() - 0.5);
            currentIndex = 0;
            doOneRotation();
            startRotation();
        }
    }
    
    function init() {
        loadSponsors();
        loadPartnerProjects();
    }

    // Initialize when document is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export for manual refresh if needed
    window.AppSponsorRotation = {
        refresh: function() {
            loadSponsors();
            loadPartnerProjects();
        },
        stop: function() {
            if (rotationInterval) {
                clearInterval(rotationInterval);
                rotationInterval = null;
            }
        }
    };
})();
