// Direct reset button implementation - completely separate from the regular UI
// This will add a new red button directly to the stateful management section

// Set a flag to prevent showing expiration update notification on reset
window.justCompletedStatefulReset = false;
// Keep track of the current stateful hours value to detect real changes
window.lastStatefulHoursValue = null;

// Run this code as soon as this script is loaded, but only on settings page
(function() {
    // Exit early if not on settings page
    function isOnSettingsPage() {
        return window.location.hash === '#settings' || window.location.pathname.includes('/settings');
    }
    
    // Don't run any of this code unless we're on the settings page
    if (!isOnSettingsPage()) {
        return;
    }
    
    function insertDirectResetButton() {
        // Look for the stateful header row
        const headerRow = document.querySelector('.stateful-header-row');
        
        if (!headerRow) {
            // If we can't find it, try again soon (we're already on settings page)
            console.log('Stateful header not found, will try again in 1 second');
            setTimeout(insertDirectResetButton, 1000);
            return;
        }
        
        // Check if our button already exists to avoid duplicates
        if (document.getElementById('emergency_reset_btn')) {
            return;
        }
        
        console.log('Found stateful header, adding emergency reset button');
        
        // Create the new button
        const resetButton = document.createElement('button');
        resetButton.id = 'emergency_reset_btn';
        resetButton.innerText = '🔥 EMERGENCY RESET 🔥';
        resetButton.style.background = 'linear-gradient(to right, #ff0000, #8b0000)';
        resetButton.style.color = 'white';
        resetButton.style.fontWeight = 'bold';
        resetButton.style.border = 'none';
        resetButton.style.borderRadius = '4px';
        resetButton.style.padding = '8px 16px';
        resetButton.style.marginLeft = '15px';
        resetButton.style.cursor = 'pointer';
        resetButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        
        // Add click handler for the new button
        resetButton.onclick = function() {
            if (confirm('⚠️ EMERGENCY RESET: Are you absolutely sure you want to reset all processed media IDs? This cannot be undone!')) {
                
                // Show loading state
                this.disabled = true;
                this.innerText = '⏳ Resetting...';
                this.style.background = '#666';
                
                // Mark that we're performing a reset to prevent expiration notification
                window.justCompletedStatefulReset = true;
                
                // Make direct API call
                HuntarrUtils.fetchWithTimeout('./api/stateful/reset', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Server returned status ' + response.status);
                    }
                    return response.json();
                })
                .then(data => {
                    alert('✅ Success! Stateful management has been reset.');
                    
                    // Reload the page with a query parameter to indicate reset was done
                    window.location.href = window.location.pathname + '?reset=done' + window.location.hash;
                })
                .catch(error => {
                    console.error('Reset failed:', error);
                    alert('❌ Reset failed: ' + error.message);
                    
                    // Restore button state
                    this.disabled = false;
                    this.innerText = '🔥 EMERGENCY RESET 🔥';
                    this.style.background = 'linear-gradient(to right, #ff0000, #8b0000)';
                    
                    // Clear the reset flag since operation failed
                    window.justCompletedStatefulReset = false;
                });
            }
            
            // Prevent event propagation
            return false;
        };
        
        // Add the button to the page
        headerRow.appendChild(resetButton);
        console.log('Emergency reset button added successfully');
        
        // Track the initial value of the stateful hours input
        const hoursInput = document.getElementById('stateful_management_hours');
        if (hoursInput) {
            window.lastStatefulHoursValue = parseInt(hoursInput.value);
            
            // Add a change listener to detect when the user actually changes the value
            hoursInput.addEventListener('change', function() {
                window.lastStatefulHoursValue = parseInt(this.value);
            });
        }
    }
    
    // Try to add the button immediately
    insertDirectResetButton();
    
    // Also try when the DOM is loaded
    document.addEventListener('DOMContentLoaded', insertDirectResetButton);
    
    // And again when everything is fully loaded
    window.addEventListener('load', insertDirectResetButton);

    // Also check periodically to make sure the button exists (we're already on settings page)
    setInterval(function() {
        const headerRow = document.querySelector('.stateful-header-row');
        if (headerRow && !document.getElementById('emergency_reset_btn')) {
            console.log('Emergency reset button missing, re-adding it');
            insertDirectResetButton();
        }
    }, 1000); // Check every second
    
    // Also listen for potential UI updates that might remove our button
    // Especially listen for when settings are saved
    const saveButton = document.getElementById('saveSettingsButton');
    if (saveButton) {
        saveButton.addEventListener('click', function() {
            // After settings are saved, the UI might refresh
            // Wait a short moment then check if our button is still there
            setTimeout(function() {
                const headerRow = document.querySelector('.stateful-header-row');
                if (headerRow && !document.getElementById('emergency_reset_btn')) {
                    console.log('Emergency reset button missing after save, re-adding it');
                    insertDirectResetButton();
                }
            }, 500); // Check half a second after save
        });
    }
    
    // Add a global interceptor for the notification system
    const originalShowNotification = window.huntarrUI && window.huntarrUI.showNotification;
    if (originalShowNotification) {
        window.huntarrUI.showNotification = function(message, type) {
            // If we just completed a reset and this is an expiration update notification, don't show it
            if (window.justCompletedStatefulReset && message.includes('Updated expiration to')) {
                console.log('Suppressing expiration update notification after reset');
                window.justCompletedStatefulReset = false; // Reset the flag
                return;
            }
            
            // Also suppress expiration notifications when saving general settings if hours didn't change
            if (message.includes('Updated expiration to')) {
                const hoursInput = document.getElementById('stateful_management_hours');
                if (hoursInput) {
                    const currentValue = parseInt(hoursInput.value);
                    // Only show notification if the value actually changed
                    if (window.lastStatefulHoursValue === currentValue) {
                        console.log('Suppressing expiration notification because hours value did not change');
                        return;
                    }
                    // Update our tracked value
                    window.lastStatefulHoursValue = currentValue;
                }
            }
            
            // Saving settings already shows a "Settings saved successfully" notification,
            // so we don't need the expiration one too - suppress it if we just saved settings
            if (message.includes('Updated expiration to') && document.getElementById('saveSettingsButton')?.disabled) {
                console.log('Suppressing expiration notification after saving general settings');
                return;
            }
            
            // Otherwise, proceed with the original notification
            return originalShowNotification.call(this, message, type);
        };
        console.log('Notification system intercepted to handle notifications properly');
    }
})();
