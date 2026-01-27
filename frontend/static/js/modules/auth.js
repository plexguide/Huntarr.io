/**
 * Authentication Module
 * Handles user login, logout, and local access bypass status
 */

window.HuntarrAuth = {
    checkLocalAccessBypassStatus: function() {
        console.log("[HuntarrAuth] Checking local access bypass status...");
        HuntarrUtils.fetchWithTimeout('./api/get_local_access_bypass_status')
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                return response.json();
            })
            .then(data => {
                if (data && typeof data.isEnabled === 'boolean') {
                    this.updateUIForLocalAccessBypass(data.isEnabled);
                } else {
                    this.updateUIForLocalAccessBypass(false);
                }
            })
            .catch(error => {
                console.error('[HuntarrAuth] Error checking local access bypass status:', error);
                this.updateUIForLocalAccessBypass(false);
            });
    },
    
    updateUIForLocalAccessBypass: function(isEnabled) {
        const userInfoContainer = document.getElementById('userInfoContainer');
        const userNav = document.getElementById('userNav');
        
        if (isEnabled === true) {
            if (userInfoContainer) userInfoContainer.style.display = 'none';
            if (userNav) {
                userNav.style.display = '';
                userNav.style.removeProperty('display');
            }
        } else {
            if (userInfoContainer) userInfoContainer.style.display = '';
            if (userNav) userNav.style.display = '';
        }
    },
    
    logout: function(e) {
        if (e) e.preventDefault();
        console.log('[HuntarrAuth] Logging out...');
        HuntarrUtils.fetchWithTimeout('./logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = './login';
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Logout failed', 'error');
            }
        })
        .catch(error => {
            console.error('[HuntarrAuth] Error during logout:', error);
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('An error occurred during logout', 'error');
        });
    }
};
