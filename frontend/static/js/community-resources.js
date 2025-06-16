/**
 * Huntarr - Community Resources Module
 * Handles showing/hiding the Community Resources section on the home page
 * based on user settings.
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize the community resources visibility immediately
    initCommunityResourcesVisibilityImmediate();
    
    // Also listen for settings changes that might affect visibility
    window.addEventListener('settings-saved', function() {
        initCommunityResourcesVisibility();
    });
});

/**
 * Immediately shows sections with cached data to prevent flashing
 */
function initCommunityResourcesVisibilityImmediate() {
    // Check if the community hub card exists
    const communityHubCard = document.querySelector('.community-hub-card');
    const huntarrSupportSection = document.querySelector('#huntarr-support-section');
    
    // Try to get cached settings first
    const cachedSettings = localStorage.getItem('huntarr-general-settings');
    if (cachedSettings) {
        try {
            const settings = JSON.parse(cachedSettings);
            
            // Show/hide based on cached settings immediately
            if (communityHubCard) {
                communityHubCard.style.display = settings.display_community_resources !== false ? '' : 'none';
            }
            if (huntarrSupportSection) {
                huntarrSupportSection.style.display = settings.display_huntarr_support !== false ? '' : 'none';
            }
            
            console.log('[Community] Applied cached visibility settings');
            
            // Still fetch fresh settings in background to update if changed
            initCommunityResourcesVisibility();
            return;
        } catch (e) {
            console.log('[Community] Failed to parse cached settings');
        }
    }
    
    // If no cache, show both by default (most common case) to prevent hiding content
    if (communityHubCard) {
        communityHubCard.style.display = '';
    }
    if (huntarrSupportSection) {
        huntarrSupportSection.style.display = '';
    }
    
    // Fetch fresh settings
    initCommunityResourcesVisibility();
}

/**
 * Initializes the visibility of the Community Resources section
 * based on the display_community_resources setting in general.json
 */
function initCommunityResourcesVisibility() {
    // Check if the community hub card exists
    const communityHubCard = document.querySelector('.community-hub-card');
    if (!communityHubCard) {
        console.log('[Community] Community hub card not found in DOM');
        return;
    }
    
    // Check if the Huntarr support section exists
    const huntarrSupportSection = document.querySelector('#huntarr-support-section');
    if (!huntarrSupportSection) {
        console.log('[Community] Huntarr support section not found in DOM');
    }
    
    // Fetch general settings to determine visibility
    HuntarrUtils.fetchWithTimeout('./api/settings/general')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('[Community] Loaded general settings:', data);
            
            // Cache the settings for immediate use next time
            localStorage.setItem('huntarr-general-settings', JSON.stringify(data));
            
            // Handle Community Resources visibility
            if (data.display_community_resources === false) {
                // Hide the community hub card
                console.log('[Community] Hiding community resources section');
                communityHubCard.style.display = 'none';
            } else {
                // Show the community hub card (default)
                console.log('[Community] Showing community resources section');
                communityHubCard.style.display = '';
            }
            
            // Handle Huntarr Support visibility (defaults to true)
            if (huntarrSupportSection) {
                if (data.display_huntarr_support === false) {
                    // Hide the Huntarr support section
                    console.log('[Community] Hiding Huntarr support section');
                    huntarrSupportSection.style.display = 'none';
                } else {
                    // Show the Huntarr support section (default)
                    console.log('[Community] Showing Huntarr support section');
                    huntarrSupportSection.style.display = '';
                }
            }
        })
        .catch(error => {
            console.error('[Community] Error loading general settings:', error);
            // Default to showing if there's an error
            communityHubCard.style.display = '';
            if (huntarrSupportSection) {
                huntarrSupportSection.style.display = '';
            }
        });
} 