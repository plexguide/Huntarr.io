/**
 * Hourly API Cap Handling for Huntarr
 * Fetches and updates the hourly API usage indicators on the dashboard
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initial load of hourly cap data
    loadHourlyCapData();
    
    // Set up polling to refresh the hourly cap data every 2 minutes (reduced from 30 seconds)
    setInterval(loadHourlyCapData, 120000);
});

/**
 * Load hourly API cap data from the server
 */
function loadHourlyCapData() {
    HuntarrUtils.fetchWithTimeout('./api/hourly-caps')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.caps && data.limits) {
                updateHourlyCapDisplay(data.caps, data.limits);
            } else {
                console.error('Failed to load hourly API cap data:', data.message || 'Unknown error');
            }
        })
        .catch(error => {
            console.error('Error fetching hourly API cap data:', error);
        });
}

/**
 * Update the hourly API cap indicators for each app
 * 
 * @param {Object} caps - Object containing hourly API usage for each app
 * @param {Object} limits - Object containing app-specific hourly API limits
 */
function updateHourlyCapDisplay(caps, limits) {
    // Update each app's API cap indicator
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];
    
    apps.forEach(app => {
        // If we have data for this app
        if (caps[app]) {
            // Get the app-specific limit
            const appLimit = limits[app] || 20; // Default to 20 if not set
            
            // Update the API count
            const countElement = document.getElementById(`${app}-api-count`);
            if (countElement) {
                countElement.textContent = caps[app].api_hits || 0;
            }
            
            // Update the API limit
            const limitElement = document.getElementById(`${app}-api-limit`);
            if (limitElement) {
                limitElement.textContent = appLimit;
            }
            
            // Update the status indicator
            const statusElement = document.getElementById(`${app}-hourly-cap`);
            if (statusElement) {
                const usage = caps[app].api_hits || 0;
                const percentage = (usage / appLimit) * 100;
                
                // Remove existing status classes
                statusElement.classList.remove('good', 'warning', 'danger');
                
                // Add appropriate status class based on usage percentage
                if (percentage >= 100) {
                    statusElement.classList.add('danger');
                } else if (percentage >= 75) {
                    statusElement.classList.add('warning');
                } else {
                    statusElement.classList.add('good');
                }
            }
        }
    });
}
