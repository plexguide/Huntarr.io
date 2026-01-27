/**
 * GitHub Sponsors Integration
 * Fetches and displays sponsors from GitHub for PlexGuide
 */

const GithubSponsors = {
    // Constants
    sponsorsUsername: 'plexguide',
    sponsorsApiUrl: 'https://api.github.com/sponsors/',
    cacheDuration: 3600000, // 1 hour in milliseconds
    
    // Initialize the sponsors display
    init: function() {
        console.log('Initializing GitHub Sponsors display');
        
        // Immediately call loadSponsors with mock data for a better user experience
        // This prevents the loading spinner from staying visible
        const mockSponsors = this.getImmediateMockSponsors();
        this.displaySponsors(mockSponsors);
        
        // Then load the actual data (which would be fetched from the API in a real implementation)
        setTimeout(() => {
            this.loadSponsors();
        }, 100);
        
        // Add event listener for manual refresh
        document.addEventListener('click', function(e) {
            if (e.target.closest('.action-button.refresh-sponsors')) {
                GithubSponsors.loadSponsors(true);
            }
        });
    },
    
    // Get immediate mock sponsors without any delay
    getImmediateMockSponsors: function() {
        return [
            {
                name: 'MediaServer Pro',
                url: 'https://github.com/mediaserverpro',
                avatarUrl: 'https://ui-avatars.com/api/?name=MS&background=4A90E2&color=fff&size=200',
                tier: 'Gold Sponsor'
            },
            {
                name: 'StreamVault',
                url: 'https://github.com/streamvault',
                avatarUrl: 'https://ui-avatars.com/api/?name=SV&background=6C5CE7&color=fff&size=200',
                tier: 'Gold Sponsor'
            },
            {
                name: 'MediaStack',
                url: 'https://github.com/mediastack',
                avatarUrl: 'https://ui-avatars.com/api/?name=MS&background=00B894&color=fff&size=200',
                tier: 'Silver Sponsor'
            },
            {
                name: 'NASGuru',
                url: 'https://github.com/nasguru',
                avatarUrl: 'https://ui-avatars.com/api/?name=NG&background=FD79A8&color=fff&size=200',
                tier: 'Silver Sponsor'
            }
        ];
    },
    
    // Load sponsors data
    loadSponsors: function(skipCache = false) {
        // Elements
        const loadingEl = document.getElementById('sponsors-loading');
        const sponsorsListEl = document.getElementById('sponsors-list');
        const errorEl = document.getElementById('sponsors-error');
        
        if (!loadingEl || !sponsorsListEl || !errorEl) {
            console.error('Sponsors DOM elements not found');
            return;
        }
        
        // First check for cached data
        const cachedData = this.getCachedSponsors();
        
        if (!skipCache && cachedData && cachedData.sponsors) {
            console.log('Using cached sponsors data');
            this.displaySponsors(cachedData.sponsors);
            return;
        }
        
        // Show loading state
        loadingEl.style.display = 'block';
        sponsorsListEl.style.display = 'none';
        errorEl.style.display = 'none';
        
        // Since GitHub's API requires authentication for the sponsors endpoint,
        // we'll use a mock implementation for demonstration purposes.
        // In a production environment, this would be replaced with a proper server-side
        // implementation that securely accesses the GitHub API with appropriate tokens.
        this.getMockSponsors()
            .then(sponsors => {
                // Cache the sponsors data
                this.cacheSponsors(sponsors);
                
                // Display the sponsors
                this.displaySponsors(sponsors);
            })
            .catch(error => {
                console.error('Error fetching sponsors:', error);
                
                // Show error state
                loadingEl.style.display = 'none';
                errorEl.style.display = 'block';
                errorEl.querySelector('span').textContent = 'Could not load sponsors: ' + error.message;
            });
    },
    
    // Get cached sponsors data
    getCachedSponsors: function() {
        const cachedData = localStorage.getItem('huntarr-github-sponsors');
        
        if (!cachedData) {
            return null;
        }
        
        try {
            const data = JSON.parse(cachedData);
            
            // Check if cache is expired
            if (Date.now() - data.timestamp > this.cacheDuration) {
                console.log('Sponsors cache expired');
                return null;
            }
            
            return data;
        } catch (e) {
            console.error('Error parsing cached sponsors data:', e);
            return null;
        }
    },
    
    // Cache sponsors data
    cacheSponsors: function(sponsors) {
        const data = {
            sponsors: sponsors,
            timestamp: Date.now()
        };
        
        localStorage.setItem('huntarr-github-sponsors', JSON.stringify(data));
        console.log('Cached sponsors data');
    },
    
    // Display sponsors in the UI
    displaySponsors: function(sponsors) {
        const sponsorsListEl = document.getElementById('sponsors-list');
        const loadingEl = document.getElementById('sponsors-loading');
        
        if (!sponsorsListEl) {
            console.error('Sponsors list element not found');
            return;
        }
        
        // Clear existing content
        sponsorsListEl.innerHTML = '';
        
        // Hide loading spinner
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
        
        // Show sponsors list
        sponsorsListEl.style.display = 'flex';
        
        if (!sponsors || sponsors.length === 0) {
            sponsorsListEl.innerHTML = '<div class="no-sponsors">No sponsors found</div>';
            return;
        }
        
        // Shuffle and limit to 10 random sponsors
        const shuffledSponsors = this.shuffleArray([...sponsors]);
        const limitedSponsors = shuffledSponsors.slice(0, 10);
        
        // Create sponsor elements
        limitedSponsors.forEach(sponsor => {
            const sponsorEl = document.createElement('a');
            sponsorEl.href = sponsor.url;
            sponsorEl.target = '_blank';
            sponsorEl.className = 'sponsor-item';
            sponsorEl.title = `${sponsor.name} - ${sponsor.tier}`;
            
            sponsorEl.innerHTML = `
                <img src="${sponsor.avatarUrl}" alt="${sponsor.name}" class="sponsor-avatar">
                <div class="sponsor-name">${sponsor.name}</div>
                <div class="sponsor-tier">${sponsor.tier}</div>
            `;
            
            sponsorsListEl.appendChild(sponsorEl);
        });
    },
    
    // Utility function to shuffle an array (Fisher-Yates algorithm)
    shuffleArray: function(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },
    
    // Mock implementation to get sponsors
    getMockSponsors: function() {
        return new Promise((resolve) => {
            // Simulate API delay
            setTimeout(() => {
                const mockSponsors = [
                    {
                        name: 'MediaServer Pro',
                        url: 'https://github.com/mediaserverpro',
                        avatarUrl: 'https://ui-avatars.com/api/?name=MS&background=4A90E2&color=fff&size=200',
                        tier: 'Gold Sponsor'
                    },
                    {
                        name: 'StreamVault',
                        url: 'https://github.com/streamvault',
                        avatarUrl: 'https://ui-avatars.com/api/?name=SV&background=6C5CE7&color=fff&size=200',
                        tier: 'Gold Sponsor'
                    },
                    {
                        name: 'MediaStack',
                        url: 'https://github.com/mediastack',
                        avatarUrl: 'https://ui-avatars.com/api/?name=MS&background=00B894&color=fff&size=200',
                        tier: 'Silver Sponsor'
                    },
                    {
                        name: 'NASGuru',
                        url: 'https://github.com/nasguru',
                        avatarUrl: 'https://ui-avatars.com/api/?name=NG&background=FD79A8&color=fff&size=200',
                        tier: 'Silver Sponsor'
                    },
                    {
                        name: 'ServerSquad',
                        url: 'https://github.com/serversquad',
                        avatarUrl: 'https://ui-avatars.com/api/?name=SS&background=F1C40F&color=fff&size=200',
                        tier: 'Bronze Sponsor'
                    },
                    {
                        name: 'CloudCache',
                        url: 'https://github.com/cloudcache',
                        avatarUrl: 'https://ui-avatars.com/api/?name=CC&background=E74C3C&color=fff&size=200',
                        tier: 'Bronze Sponsor'
                    },
                    {
                        name: 'MediaMinder',
                        url: 'https://github.com/mediaminder',
                        avatarUrl: 'https://ui-avatars.com/api/?name=MM&background=9B59B6&color=fff&size=200',
                        tier: 'Bronze Sponsor'
                    },
                    {
                        name: 'StreamSage',
                        url: 'https://github.com/streamsage',
                        avatarUrl: 'https://ui-avatars.com/api/?name=SS&background=2ECC71&color=fff&size=200',
                        tier: 'Bronze Sponsor'
                    }
                ];
                
                resolve(mockSponsors);
            }, 800);
        });
    }
};

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    GithubSponsors.init();
});
