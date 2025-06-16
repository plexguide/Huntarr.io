/**
 * Eros.js - Handles Eros settings and interactions in the Huntarr UI
 */

document.addEventListener('DOMContentLoaded', function() {
    // Don't call setupErosForm here, new-main.js will call it when the tab is active
    // setupErosForm(); 
    // setupErosLogs(); // Assuming logs are handled by the main logs section
    // setupClearProcessedButtons('eros'); // Assuming this is handled elsewhere or not needed immediately
});

/**
 * Setup Eros settings form and connection test
 * This function is now called by new-main.js when the Eros settings tab is shown.
 */
function setupErosForm() {
    console.log("[eros.js] Setting up Eros form...");
    const panel = document.getElementById('erosSettings'); 
    if (!panel) {
        console.warn("[eros.js] Eros settings panel not found.");
        return;
    }
  
    const testErosButton = panel.querySelector('#test-eros-button');
    const erosStatusIndicator = panel.querySelector('#eros-connection-status');
    const erosVersionDisplay = panel.querySelector('#eros-version');
    const apiUrlInput = panel.querySelector('#eros_api_url');
    const apiKeyInput = panel.querySelector('#eros_api_key');
    
    // Check if event listener is already attached (prevents duplicate handlers)
    if (!testErosButton || testErosButton.dataset.listenerAttached === 'true') {
         console.log("[eros.js] Test button not found or listener already attached.");
         return;
    }
     console.log("[eros.js] Setting up Eros form listeners.");
     testErosButton.dataset.listenerAttached = 'true'; // Mark as attached
    
    // Add event listener for connection test
    testErosButton.addEventListener('click', function() {
        console.log("[eros.js] Testing Eros connection...");
        
        // Temporarily suppress change detection to prevent the unsaved changes dialog
        window._suppressUnsavedChangesDialog = true;
        
        // Basic validation
        if (!apiUrlInput.value || !apiKeyInput.value) {
            // Reset suppression flag
            window._suppressUnsavedChangesDialog = false;
            
            if (typeof huntarrUI !== 'undefined') {
                huntarrUI.showNotification('Please enter both API URL and API Key for Eros', 'error');
            } else {
                alert('Please enter both API URL and API Key for Eros');
            }
            return;
        }
        
        // Disable button during test and show pending status
        testErosButton.disabled = true;
        if (erosStatusIndicator) {
            erosStatusIndicator.className = 'connection-status pending';
            erosStatusIndicator.textContent = 'Testing...';
        }
        
        // Call API to test connection
        HuntarrUtils.fetchWithTimeout('./api/eros/test-connection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_url: apiUrlInput.value,
                api_key: apiKeyInput.value,
                api_timeout: 30
            })
        }, 30000) // 30 second timeout
        .then(response => response.json())
        .then(data => {
            // Enable the button again
            testErosButton.disabled = false;
            
            // Reset suppression flag after a short delay
            setTimeout(() => {
                window._suppressUnsavedChangesDialog = false;
            }, 500);
            
            if (erosStatusIndicator) {
                if (data.success) {
                    erosStatusIndicator.className = 'connection-status success';
                    erosStatusIndicator.textContent = 'Connected';
                    if (typeof huntarrUI !== 'undefined') {
                         huntarrUI.showNotification('Successfully connected to Eros', 'success');
                    }
                    getErosVersion(); // Fetch version after successful connection
                } else {
                    erosStatusIndicator.className = 'connection-status failure';
                    erosStatusIndicator.textContent = 'Failed';
                    if (typeof huntarrUI !== 'undefined') {
                        huntarrUI.showNotification(data.message || 'Failed to connect to Eros', 'error');
                    } else {
                        alert(data.message || 'Failed to connect to Eros');
                    }
                }
            }
        })
        .catch(error => {
            console.error('[eros.js] Error testing connection:', error);
            testErosButton.disabled = false;
            
            // Reset suppression flag
            window._suppressUnsavedChangesDialog = false;
            
            if (erosStatusIndicator) {
                erosStatusIndicator.className = 'connection-status failure';
                erosStatusIndicator.textContent = 'Error';
            }
            
            if (typeof huntarrUI !== 'undefined') {
                huntarrUI.showNotification('Error testing connection: ' + error.message, 'error');
            } else {
                alert('Error testing connection: ' + error.message);
            }
        });
    });
    
    // Initialize form state and fetch data
    refreshErosStatusAndVersion();
}

/**
 * Get the Eros software version from the instance.
 * This is separate from the API test.
 */
function getErosVersion() {
    const panel = document.getElementById('erosSettings');
    if (!panel) return;
    
    const versionDisplay = panel.querySelector('#eros-version');
    if (!versionDisplay) return;
    
    // Try to get the API settings from the form
    const apiUrlInput = panel.querySelector('#eros_api_url');
    const apiKeyInput = panel.querySelector('#eros_api_key');
    
    if (!apiUrlInput || !apiUrlInput.value || !apiKeyInput || !apiKeyInput.value) {
        versionDisplay.textContent = 'N/A';
        return;
    }
    
    // Endpoint to get version info - using the test endpoint since it returns version
    HuntarrUtils.fetchWithTimeout('./api/eros/test-connection', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            api_url: apiUrlInput.value,
            api_key: apiKeyInput.value,
            api_timeout: 10
        })
    }, 10000)
    .then(response => response.json())
    .then(data => {
        if (data.success && data.version) {
            versionDisplay.textContent = 'v' + data.version;
        } else {
            versionDisplay.textContent = 'Unknown';
        }
    })
    .catch(error => {
        console.error('[eros.js] Error fetching version:', error);
        versionDisplay.textContent = 'Error';
    });
}

/**
 * Refresh the connection status and version display for Eros.
 */
function refreshErosStatusAndVersion() {
    // Try to get current connection status from the server
    HuntarrUtils.fetchWithTimeout('./api/eros/status')
        .then(response => response.json())
        .then(data => {
            const panel = document.getElementById('erosSettings');
            if (!panel) return;
            
            const statusIndicator = panel.querySelector('#eros-connection-status');
            if (statusIndicator) {
                if (data.connected) {
                    statusIndicator.className = 'connection-status success';
                    statusIndicator.textContent = 'Connected';
                    getErosVersion(); // Try to get version if connected
                } else if (data.configured) {
                    statusIndicator.className = 'connection-status failure';
                    statusIndicator.textContent = 'Not Connected';
                } else {
                    statusIndicator.className = 'connection-status pending';
                    statusIndicator.textContent = 'Not Configured';
                }
            }
        })
        .catch(error => {
            console.error('[eros.js] Error checking status:', error);
        });
}

// Mark functions as global if needed by other parts of the application
window.setupErosForm = setupErosForm;
window.getErosVersion = getErosVersion;
window.refreshErosStatusAndVersion = refreshErosStatusAndVersion;
