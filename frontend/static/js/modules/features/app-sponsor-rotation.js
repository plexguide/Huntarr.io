/**
 * App Sponsor Banner Rotation
 * Shows rotating sponsors on all app pages (Sonarr, Radarr, etc.)
 * Same functionality as home page sponsor banner.
 * Also runs Partner Projects rotation (Cleanuparr, SeekandWatch) for home + all app pages.
 */

(function() {
    const APP_SPONSOR_CACHE_KEY = 'app_sponsor_cache';
    const CACHE_DURATION = 60 * 1000; // 1 minute - sponsor/partner stay the same across pages
    const ROTATION_INTERVAL = 60 * 1000; // 1 minute rotation

    const PARTNER_PROJECTS_CACHE_KEY = 'home_partner_projects_cache';
    const PARTNER_PROJECTS = [
        { name: 'Cleanuparr', url: 'https://github.com/se1exin/Cleanarr' },
        { name: 'SeekandWatch', url: 'https://github.com/softerfish/seekandwatch' }
    ];
    const APP_TYPES = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'requestarr'];
    // Home + all app pages use the same sponsor rotation (same cache, same 1-min interval)
    const SPONSOR_SECTIONS = ['home', ...APP_TYPES];

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
    }

    // --- Partner Projects (Cleanuparr, SeekandWatch) - home + all app pages ---
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

    function updateAllPartnerBanners(project) {
        // Home page
        const homeName = document.getElementById('partner-projects-name');
        const homeBanner = document.getElementById('partner-projects-banner');
        if (homeName) homeName.textContent = project.name;
        if (homeBanner && project.url) {
            homeBanner.href = project.url;
            homeBanner.setAttribute('data-partner-url', project.url);
        }
        // App pages
        APP_TYPES.forEach(appType => {
            const nameEl = document.getElementById(`${appType}-partner-projects-name`);
            const bannerEl = document.getElementById(`${appType}-partner-projects-banner`);
            if (nameEl) nameEl.textContent = project.name;
            if (bannerEl && project.url) {
                bannerEl.href = project.url;
                bannerEl.setAttribute('data-partner-url', project.url);
            }
        });
    }

    function loadPartnerProjects() {
        const cached = getCachedPartner();
        if (cached) {
            updateAllPartnerBanners(cached);
            return;
        }
        const project = getRandomPartner();
        if (project) {
            updateAllPartnerBanners(project);
            cachePartner(project);
        } else {
            updateAllPartnerBanners({ name: '—', url: '#' });
        }
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
    
    async function loadSponsors() {
        const cached = getCachedSponsor();
        
        if (cached) {
            // Keep showing cached sponsor for the full 1-minute window (no change on refresh/navigation)
            updateAllAppBanners(cached.sponsor);
            try {
                const response = await fetch('./api/github_sponsors');
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                sponsors = await response.json();
                if (sponsors && sponsors.length > 0) {
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
                startRotation();
            }
            return;
        }
        
        // No valid cache: fetch, show one, cache it, rotate every 1 minute
        try {
            const response = await fetch('./api/github_sponsors');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            sponsors = await response.json();
            if (sponsors && sponsors.length > 0) {
                sponsors = sponsors.sort(() => Math.random() - 0.5);
                currentIndex = 0;
                doOneRotation();
                startRotation();
            } else {
                updateAllAppBanners({ name: 'Be the first!', url: 'https://plexguide.github.io/Huntarr.io/donate.html' });
            }
        } catch (error) {
            console.error('Error fetching app sponsors:', error);
            updateAllAppBanners({ name: 'Support us!', url: 'https://plexguide.github.io/Huntarr.io/donate.html' });
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
