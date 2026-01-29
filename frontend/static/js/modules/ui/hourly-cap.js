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
window.loadHourlyCapData = function loadHourlyCapData() {
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
};

/**
 * Update the hourly API cap indicators for each app
 * 
 * @param {Object} caps - Object containing hourly API usage for each app
 * @param {Object} limits - Object containing app-specific hourly API limits
 */
function updateHourlyCapDisplay(caps, limits) {
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];
    
    apps.forEach(app => {
        if (!caps[app]) return;
        const appLimit = limits[app] || 20;
        const usage = caps[app].api_hits || 0;
        const percentage = (appLimit > 0) ? (usage / appLimit) * 100 : 0;
        
        // Update every card for this app (single card or per-instance cards)
        const cards = document.querySelectorAll('.app-stats-card.' + app);
        cards.forEach(card => {
            const countEl = card.querySelector('.hourly-cap-text span');
            const limitEl = card.querySelectorAll('.hourly-cap-text span')[1];
            if (countEl) countEl.textContent = usage;
            if (limitEl) limitEl.textContent = appLimit;
            
            const statusEl = card.querySelector('.hourly-cap-status');
            if (statusEl) {
                statusEl.classList.remove('good', 'warning', 'danger');
                if (percentage >= 100) statusEl.classList.add('danger');
                else if (percentage >= 75) statusEl.classList.add('warning');
                else statusEl.classList.add('good');
            }
        });
    });
}
