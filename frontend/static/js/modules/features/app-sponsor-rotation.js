/**
 * App Sponsor Banner Rotation
 * Shows rotating sponsors on all app pages (Sonarr, Radarr, etc.)
 * Same functionality as home page sponsor banner
 */

(function() {
    const APP_SPONSOR_CACHE_KEY = 'app_sponsor_cache';
    const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes in milliseconds
    const ROTATION_INTERVAL = 17000; // 17 seconds
    
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
            
            // Check if cache is still valid (within 2 minutes)
            if (now - timestamp < CACHE_DURATION) {
                return sponsor;
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
        const appTypes = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr'];
        appTypes.forEach(appType => {
            updateSponsorBanner(sponsor, appType);
        });
    }
    
    function startRotation() {
        if (rotationInterval) {
            clearInterval(rotationInterval);
        }
        
        rotationInterval = setInterval(() => {
            const sponsor = getNextSponsor();
            if (sponsor) {
                updateAllAppBanners(sponsor);
                cacheSponsor(sponsor);
            }
        }, ROTATION_INTERVAL);
    }
    
    async function loadSponsors() {
        // Check cache first
        const cachedSponsor = getCachedSponsor();
        if (cachedSponsor) {
            updateAllAppBanners(cachedSponsor);
        }
        
        // Fetch from API
        try {
            const response = await fetch('./api/github_sponsors');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            sponsors = await response.json();
            
            if (sponsors && sponsors.length > 0) {
                // Shuffle sponsors for randomness
                sponsors = sponsors.sort(() => Math.random() - 0.5);
                currentIndex = 0;
                
                // Show first sponsor
                const firstSponsor = getNextSponsor();
                if (firstSponsor) {
                    updateAllAppBanners(firstSponsor);
                    cacheSponsor(firstSponsor);
                }
                
                // Start rotation
                startRotation();
            } else {
                updateAllAppBanners({ name: 'Be the first!', url: 'https://plexguide.github.io/Huntarr.io/donate.html' });
            }
        } catch (error) {
            console.error('Error fetching app sponsors:', error);
            updateAllAppBanners({ name: 'Support us!', url: 'https://plexguide.github.io/Huntarr.io/donate.html' });
        }
    }
    
    // Initialize when document is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadSponsors);
    } else {
        loadSponsors();
    }
    
    // Export for manual refresh if needed
    window.AppSponsorRotation = {
        refresh: loadSponsors,
        stop: function() {
            if (rotationInterval) {
                clearInterval(rotationInterval);
                rotationInterval = null;
            }
        }
    };
})();
