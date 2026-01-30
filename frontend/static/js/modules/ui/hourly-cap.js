/**
 * Hourly API Cap Handling for Huntarr
 * Fetches and updates the hourly API usage indicators on the dashboard
 */

document.addEventListener('DOMContentLoaded', function() {
    // Set up polling to refresh the hourly cap data every 2 minutes
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
 * Get instance name for a card (from card attribute or reset button).
 * @param {Element} card - .app-stats-card element
 * @returns {string|null} Instance name or null for single-app
 */
function getInstanceNameForCard(card) {
    // Check card attribute first (most reliable)
    if (card.hasAttribute('data-instance-name')) {
        return card.getAttribute('data-instance-name');
    }
    // Fallback to reset button
    const resetBtn = card.querySelector('.cycle-reset-button[data-instance-name]');
    return resetBtn ? resetBtn.getAttribute('data-instance-name') : null;
}

/**
 * Update the hourly API cap indicators for each app (per-instance when app has instances).
 * Data is keyed by instance name; fallback to index so 2nd+ instance cards always update.
 * @param {Object} caps - Hourly API usage: per-app or per-instance (caps[app].instances[instanceName])
 * @param {Object} limits - Limits: per-app number or per-instance (limits[app].instances[instanceName])
 */
function updateHourlyCapDisplay(caps, limits) {
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];

    apps.forEach(app => {
        if (!caps[app]) return;
        const cards = document.querySelectorAll('.app-stats-card.' + app);
        const hasInstances = caps[app].instances && typeof caps[app].instances === 'object';
        const appLimit = typeof limits[app] === 'number' ? limits[app] : 20;
        const usage = !hasInstances && caps[app].api_hits != null ? caps[app].api_hits : 0;

        let instanceNames = [];
        if (hasInstances && limits[app] && limits[app].instances) {
            instanceNames = Object.keys(caps[app].instances);
        }

        cards.forEach((card, cardIndex) => {
            let usageVal = usage;
            let limitVal = appLimit;
            if (hasInstances && instanceNames.length > 0) {
                const instanceName = getInstanceNameForCard(card);
                const nameToUse = instanceName != null && caps[app].instances[instanceName] != null
                    ? instanceName
                    : instanceNames[cardIndex] || null;
                const instCaps = nameToUse != null ? caps[app].instances[nameToUse] : null;
                const instLimits = limits[app].instances && nameToUse != null ? limits[app].instances[nameToUse] : appLimit;
                usageVal = instCaps && instCaps.api_hits != null ? instCaps.api_hits : 0;
                limitVal = instLimits != null ? instLimits : 20;
            }
            const pct = (limitVal > 0) ? (usageVal / limitVal) * 100 : 0;
            const countEl = card.querySelector('.hourly-cap-text span');
            const limitEl = card.querySelectorAll('.hourly-cap-text span')[1];
            if (countEl) countEl.textContent = usageVal;
            if (limitEl) limitEl.textContent = limitVal;
            const statusEl = card.querySelector('.hourly-cap-status');
            if (statusEl) {
                statusEl.classList.remove('good', 'warning', 'danger');
                if (pct >= 100) statusEl.classList.add('danger');
                else if (pct >= 75) statusEl.classList.add('warning');
                else statusEl.classList.add('good');
            }
            const progressFill = card.querySelector('.api-progress-fill');
            if (progressFill) progressFill.style.width = Math.min(100, pct) + '%';
            const progressSpans = card.querySelectorAll('.api-progress-text span');
            if (progressSpans.length >= 2) {
                progressSpans[0].textContent = usageVal;
                progressSpans[1].textContent = limitVal;
            }
        });
    });
}
