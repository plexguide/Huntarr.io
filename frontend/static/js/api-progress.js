/**
 * API Progress Bar Enhancement
 * Connects to the existing hourly-cap system to show real API usage data
 */

function updateApiProgress(appName, used, total) {
    const progressFill = document.getElementById(`${appName}-api-progress`);
    const usedSpan = document.getElementById(`${appName}-api-used`);
    const totalSpan = document.getElementById(`${appName}-api-total`);
    
    if (progressFill && usedSpan && totalSpan) {
        const percentage = (used / total) * 100;
        progressFill.style.width = `${percentage}%`;
        
        // Create a dynamic gradient that transitions colors based on the current percentage
        let gradient;
        if (percentage <= 35) {
            // Pure green zone
            gradient = '#22c55e';
        } else if (percentage <= 50) {
            // Green to yellow transition zone
            gradient = `linear-gradient(90deg, 
                #22c55e 0%, 
                #22c55e ${35 * 100 / percentage}%, 
                #f59e0b 100%)`;
        } else if (percentage <= 70) {
            // Green through yellow to orange zone
            gradient = `linear-gradient(90deg, 
                #22c55e 0%, 
                #22c55e ${35 * 100 / percentage}%, 
                #f59e0b ${50 * 100 / percentage}%, 
                #ea580c 100%)`;
        } else {
            // Full gradient from green to red
            gradient = `linear-gradient(90deg, 
                #22c55e 0%, 
                #22c55e ${35 * 100 / percentage}%, 
                #f59e0b ${50 * 100 / percentage}%, 
                #ea580c ${70 * 100 / percentage}%, 
                #ef4444 100%)`;
        }
        
        progressFill.style.background = gradient;
        usedSpan.textContent = used;
        totalSpan.textContent = total;
    }
}

function syncProgressBarsWithApiCounts() {
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
    
    apps.forEach(app => {
        // Get the current API count and limit from the existing system
        const countElement = document.getElementById(`${app}-api-count`);
        const limitElement = document.getElementById(`${app}-api-limit`);
        
        if (countElement && limitElement) {
            const used = parseInt(countElement.textContent) || 0;
            const total = parseInt(limitElement.textContent) || 20;
            
            // Update the progress bar with real data
            updateApiProgress(app, used, total);
        }
    });
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initial sync with existing API count data
    syncProgressBarsWithApiCounts();
    
    // Set up a MutationObserver to watch for changes to the API count elements
    // This will automatically update progress bars when the hourly-cap.js updates the counts
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
    
    apps.forEach(app => {
        const countElement = document.getElementById(`${app}-api-count`);
        const limitElement = document.getElementById(`${app}-api-limit`);
        
        if (countElement && limitElement) {
            // Watch for changes to the API count
            const countObserver = new MutationObserver(() => {
                const used = parseInt(countElement.textContent) || 0;
                const total = parseInt(limitElement.textContent) || 20;
                updateApiProgress(app, used, total);
            });
            
            // Watch for changes to the API limit
            const limitObserver = new MutationObserver(() => {
                const used = parseInt(countElement.textContent) || 0;
                const total = parseInt(limitElement.textContent) || 20;
                updateApiProgress(app, used, total);
            });
            
            // Start observing
            countObserver.observe(countElement, { childList: true, characterData: true, subtree: true });
            limitObserver.observe(limitElement, { childList: true, characterData: true, subtree: true });
        }
    });
    
    // Also sync every 2 minutes (same as hourly-cap.js polling)
    setInterval(syncProgressBarsWithApiCounts, 120000);
});

// Export function for external use
window.updateApiProgress = updateApiProgress;
window.syncProgressBarsWithApiCounts = syncProgressBarsWithApiCounts;