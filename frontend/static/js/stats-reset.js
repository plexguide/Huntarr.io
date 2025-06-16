/**
 * Stats Reset Handler
 * Provides a unified way to handle stats reset operations
 */

document.addEventListener('DOMContentLoaded', function() {
    // Find the reset button on the home page
    const resetButton = document.getElementById('reset-stats');
    
    if (resetButton) {
        console.log('Stats reset button found, attaching handler');
        
        resetButton.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Prevent double-clicks
            if (this.disabled) return;
            
            // First update the UI immediately for responsive feedback
            resetStatsUI();
            
            // Then make the API call to persist the changes
            resetStatsAPI()
                .then(response => {
                    console.log('Stats reset response:', response);
                    if (!response.success) {
                        console.warn('Server reported an error with stats reset:', response.error);
                    }
                })
                .catch(error => {
                    console.error('Error during stats reset:', error);
                });
        });
    }
});

/**
 * Reset the stats UI immediately for responsive feedback
 */
function resetStatsUI() {
    // Find all stat counters and reset them to 0
    const statCounters = document.querySelectorAll('.stat-number');
    statCounters.forEach(counter => {
        if (counter && counter.textContent) {
            counter.textContent = '0';
        }
    });
    
    // Show success notification if available
    if (window.huntarrUI && typeof window.huntarrUI.showNotification === 'function') {
        window.huntarrUI.showNotification('Statistics reset successfully', 'success');
    }
}

/**
 * Make the API call to reset stats on the server
 * @param {string|null} appType - Optional specific app to reset
 * @returns {Promise} - Promise resolving to the API response
 */
function resetStatsAPI(appType = null) {
    const requestBody = appType ? { app_type: appType } : {};
    
    // Use the public endpoint that doesn't require authentication
    return HuntarrUtils.fetchWithTimeout('./api/stats/reset_public', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Server responded with status: ' + response.status);
        }
        return response.json();
    });
}

// Make resetStatsAPI available globally so other scripts can use it
window.resetStatsAPI = resetStatsAPI;
