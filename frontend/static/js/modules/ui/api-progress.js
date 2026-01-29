/**
 * API Progress Bar Enhancement
 * Connects to the existing hourly-cap system to show real API usage data
 */

function updateApiProgress(appName, used, total) {
    const cards = document.querySelectorAll('.app-stats-card.' + appName);
    const safeTotal = total > 0 ? total : 20;
    const percentage = (used / safeTotal) * 100;
    
    let gradient;
    if (percentage <= 35) gradient = '#22c55e';
    else if (percentage <= 50) gradient = `linear-gradient(90deg, #22c55e 0%, #22c55e ${35 * 100 / percentage}%, #f59e0b 100%)`;
    else if (percentage <= 70) gradient = `linear-gradient(90deg, #22c55e 0%, #22c55e ${35 * 100 / percentage}%, #f59e0b ${50 * 100 / percentage}%, #ea580c 100%)`;
    else gradient = `linear-gradient(90deg, #22c55e 0%, #22c55e ${35 * 100 / percentage}%, #f59e0b ${50 * 100 / percentage}%, #ea580c ${70 * 100 / percentage}%, #ef4444 100%)`;
    
    cards.forEach(card => {
        const progressFill = card.querySelector('.api-progress-fill');
        const spans = card.querySelectorAll('.api-progress-text span');
        const usedSpan = spans[0];
        const totalSpan = spans[1];
        if (progressFill && usedSpan && totalSpan) {
            progressFill.style.width = `${percentage}%`;
            progressFill.style.background = gradient;
            usedSpan.textContent = used;
            totalSpan.textContent = safeTotal;
        }
    });
}

function syncProgressBarsWithApiCounts() {
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
    
    apps.forEach(app => {
        const firstCard = document.querySelector('.app-stats-card.' + app);
        if (!firstCard) return;
        const countEl = firstCard.querySelector('.hourly-cap-text span');
        const limitEl = firstCard.querySelectorAll('.hourly-cap-text span')[1];
        if (countEl && limitEl) {
            const used = parseInt(countEl.textContent, 10) || 0;
            const total = parseInt(limitEl.textContent, 10) || 20;
            updateApiProgress(app, used, total);
        }
    });
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initial sync with existing API count data
    syncProgressBarsWithApiCounts();
    
    // Watch first card per app for count/limit changes (hourly-cap.js updates them)
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
    apps.forEach(app => {
        const firstCard = document.querySelector('.app-stats-card.' + app);
        if (!firstCard) return;
        const countEl = firstCard.querySelector('.hourly-cap-text span');
        const limitEl = firstCard.querySelectorAll('.hourly-cap-text span')[1];
        if (!countEl || !limitEl) return;
        const sync = () => {
            const used = parseInt(countEl.textContent, 10) || 0;
            const total = parseInt(limitEl.textContent, 10) || 20;
            updateApiProgress(app, used, total);
        };
        const obs = new MutationObserver(sync);
        obs.observe(countEl, { childList: true, characterData: true, subtree: true });
        obs.observe(limitEl, { childList: true, characterData: true, subtree: true });
    });
    
    // Also sync every 2 minutes (same as hourly-cap.js polling)
    setInterval(syncProgressBarsWithApiCounts, 120000);
});

// Export function for external use
window.updateApiProgress = updateApiProgress;
window.syncProgressBarsWithApiCounts = syncProgressBarsWithApiCounts;