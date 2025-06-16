/**
 * Cycle Countdown Timer
 * Shows countdown timers for each app's next cycle
 */

window.CycleCountdown = (function() {
    // Cache for next cycle timestamps
    const nextCycleTimes = {};
    // Active timer intervals
    const timerIntervals = {};
    // Track apps that are currently running cycles
    const runningCycles = {};
    // List of apps to track
    const trackedApps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'whisparr-v3', 'eros', 'swaparr'];
    
    // Get base URL for API calls, respecting subpath configuration
    function getBaseUrl() {
        return window.location.origin + window.location.pathname.replace(/\/+$/, '');
    }
    
    // Build a complete URL with the correct base path
    function buildUrl(path) {
        // Simply return path since we're using absolute paths
        // Make sure the path starts with a slash
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        
        // For API endpoints, use the current origin without any subpath manipulation
        return window.location.origin + path;
    }
    
    // Set up timer elements in the DOM
    function setupTimerElements() {
        // Create timer elements in each app status card
        trackedApps.forEach(app => {
            createTimerElement(app);
        });
    }
    
    // Initialize countdown timers for all apps
    function initialize() {
        console.log('[CycleCountdown] Initializing countdown timers');
        
        // Clear any existing running cycle states
        Object.keys(runningCycles).forEach(app => {
            runningCycles[app] = false;
        });
        
        // Get references to all HTML elements
        setupTimerElements();
        
        // Set up event listeners for reset buttons
        setupResetButtonListeners();
        
        // First try to fetch from API
        console.log('[CycleCountdown] Fetching initial data from API...');
        fetchAllCycleData()
            .then((data) => {
                if (data && Object.keys(data).length > 0) {
                    console.log('[CycleCountdown] Initial data fetch successful');
                } else {
                    console.log('[CycleCountdown] No apps configured yet - countdown will activate when apps are set up');
                }
                // Success - data is processed in fetchAllCycleData
            })
            .catch((error) => {
                console.warn('[CycleCountdown] Initial data fetch failed:', error.message);
                // Show waiting message in the UI if initial load fails
                displayWaitingForCycle();
            });
        
        // Simple refresh every 10 seconds with fixed interval
        let refreshInterval = null;
        
        function startRefreshInterval() {
            // Clear any existing interval
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
            
            // Set up API sync every 30 seconds (reduced from 10 seconds, not for display, just for accuracy)
            refreshInterval = setInterval(() => {
                // Only refresh if not already fetching
                if (!isFetchingData) {
                    console.log('[CycleCountdown] API sync (every 30s) to maintain accuracy...');
                    fetchAllCycleData()
                        .then((data) => {
                            if (data && Object.keys(data).length > 0) {
                                console.log('[CycleCountdown] API sync completed, timers will self-correct');
                            }
                            // Don't log anything when no apps are configured - this is normal
                        })
                        .catch(() => {
                            console.log('[CycleCountdown] API sync failed, timers continue with last known data');
                        });
                }
            }, 30000); // API sync every 30 seconds (reduced from 10 seconds)
            
            console.log('[CycleCountdown] API sync interval started (30s) - timers run independently at 1s');
        }
        
        // Start the refresh cycle
        startRefreshInterval();
    }
    
    // Simple lock to prevent concurrent fetches
    let isFetchingData = false;
    
    // Set up reset button click listeners
    function setupResetButtonListeners() {
        // Find all reset buttons
        const resetButtons = document.querySelectorAll('button.cycle-reset-button');
        
        resetButtons.forEach(button => {
            button.addEventListener('click', function() {
                const app = this.getAttribute('data-app');
                if (app) {
                    console.log(`[CycleCountdown] Reset button clicked for ${app}, will keep refreshing until new timer data is available`);
                    
                    // Add a loading state to the timer and mark it as waiting for reset
                    const timerElement = document.getElementById(`${app}CycleTimer`);
                    if (timerElement) {
                        const timerValue = timerElement.querySelector('.timer-value');
                        if (timerValue) {
                            // Store the original next cycle time before reset
                            const originalNextCycle = nextCycleTimes[app] ? nextCycleTimes[app].getTime() : null;
                            timerElement.setAttribute('data-original-cycle-time', originalNextCycle);
                            
                            timerValue.textContent = 'Refreshing';
                            timerValue.classList.add('refreshing-state');
                            timerValue.style.color = '#00c2ce';
                            // Mark this timer as waiting for reset data
                            timerElement.setAttribute('data-waiting-for-reset', 'true');
                        }
                    }
                    
                    // Start polling for new data more frequently after reset
                    startResetPolling(app);
                }
            });
        });
    }
    
    // Poll more frequently after a reset until new data is available
    function startResetPolling(app) {
        let pollAttempts = 0;
        const maxPollAttempts = 60; // Poll for up to 5 minutes (60 * 5 seconds)
        
        const pollInterval = setInterval(() => {
            pollAttempts++;
            console.log(`[CycleCountdown] Polling attempt ${pollAttempts} for ${app} reset data`);
            
            fetchAllCycleData()
                .then(() => {
                    // Check if we got new data for this specific app
                    const timerElement = document.getElementById(`${app}CycleTimer`);
                    if (timerElement && timerElement.getAttribute('data-waiting-for-reset') === 'true') {
                        // Check if we have valid next cycle time for this app
                        if (nextCycleTimes[app]) {
                            const currentCycleTime = nextCycleTimes[app].getTime();
                            const originalCycleTime = parseInt(timerElement.getAttribute('data-original-cycle-time'));
                            
                            // Only consider reset complete if we have a DIFFERENT cycle time
                            // or if the original was null (no previous timer)
                            if (originalCycleTime === null || currentCycleTime !== originalCycleTime) {
                                console.log(`[CycleCountdown] New reset data received for ${app} (original: ${originalCycleTime}, new: ${currentCycleTime}), stopping polling`);
                                timerElement.removeAttribute('data-waiting-for-reset');
                                timerElement.removeAttribute('data-original-cycle-time');
                                clearInterval(pollInterval);
                                updateTimerDisplay(app);
                            } else {
                                console.log(`[CycleCountdown] Same cycle time for ${app} (${currentCycleTime}), continuing to poll for new data`);
                            }
                        }
                    }
                })
                .catch(() => {
                    // Continue polling on error
                });
            
            // Stop polling after max attempts
            if (pollAttempts >= maxPollAttempts) {
                console.log(`[CycleCountdown] Max polling attempts reached for ${app}, stopping`);
                const timerElement = document.getElementById(`${app}CycleTimer`);
                if (timerElement) {
                    timerElement.removeAttribute('data-waiting-for-reset');
                    timerElement.removeAttribute('data-original-cycle-time');
                    const timerValue = timerElement.querySelector('.timer-value');
                    if (timerValue) {
                        timerValue.textContent = '--:--:--';
                        timerValue.classList.remove('refreshing-state');
                        timerValue.style.removeProperty('color');
                    }
                }
                clearInterval(pollInterval);
            }
        }, 5000); // Poll every 5 seconds
    }
    
    // Display initial loading message in the UI when sleep data isn't available yet
    function displayWaitingForCycle() {
        // For each app, display waiting message in timer elements only if they don't have valid data
        trackedApps.forEach(app => {
            // Only show waiting message if we don't already have valid cycle data for this app
            if (!nextCycleTimes[app]) {
                const timerElement = document.getElementById(`${app}CycleTimer`);
                if (timerElement) {
                    const timerValue = timerElement.querySelector('.timer-value');
                    if (timerValue && timerValue.textContent === '--:--:--') {
                        // Show "Waiting for Cycle" for apps without cycle data
                        timerValue.textContent = 'Waiting for Cycle';
                        timerValue.classList.add('refreshing-state');
                        timerValue.style.color = '#00c2ce'; // Light blue for waiting
                    }
                }
            }
        });
    }
    
    // Create timer display element in the app stats card
    function createTimerElement(app) {
        console.log(`[CycleCountdown] Creating timer element for ${app}`);
        
        // Handle special case for whisparr-v3 - convert hyphen to be CSS compatible
        const dataApp = app;
        
        // Get the CSS class name version of the app (replacing hyphens with nothing)
        const cssClass = app.replace(/-/g, '');
        
        // Directly look for the reset cycle button by data-app attribute
        const resetButton = document.querySelector(`button.cycle-reset-button[data-app="${dataApp}"]`);
        
        if (!resetButton) {
            // Silently skip if reset button doesn't exist on this page
            return;
        }
        
        // Check if timer element already exists
        let timerElement = document.getElementById(`${app}CycleTimer`);
        if (timerElement) return;
        
        // Create a container to hold both elements side by side
        const container = document.createElement('div');
        container.className = 'reset-and-timer-container';
        container.style.display = 'flex';
        container.style.justifyContent = 'space-between';
        container.style.alignItems = 'center';
        container.style.width = '100%';
        container.style.marginTop = '8px';
        
        // Replace the button with our container
        resetButton.parentNode.insertBefore(container, resetButton);
        container.appendChild(resetButton);
        
        // Find the app card to get its parent for the app class
        const appCard = resetButton.closest('.app-card');
        
        // Create timer element
        timerElement = document.createElement('div');
        timerElement.id = `${app}CycleTimer`;
        timerElement.className = 'cycle-timer inline-timer';
        timerElement.innerHTML = '<i class="fas fa-clock"></i> <span class="timer-value">--:--:--</span>';
        
        // Apply direct styling to ensure colors show correctly
        if (app === 'eros') {
            // Apply direct styling for Whisparr V3 (eros) with !important to ensure it shows
            timerElement.style.cssText = 'border-left: 2px solid #ff45b7 !important;';
            console.log('[CycleCountdown] Applied Whisparr V3 (eros) styling');
        }
        
        // Always apply app-specific styling class
        timerElement.classList.add(cssClass);
        
        // Also add a custom data attribute for easier styling/debugging
        timerElement.setAttribute('data-app-type', app);
        
        // Add a timer icon with app-specific color
        const timerIcon = timerElement.querySelector('i');
        if (timerIcon) {
            timerIcon.classList.add(`${cssClass}-icon`);
        }
        
        console.log(`[CycleCountdown] Applied app-specific styling class: ${cssClass}`);
        
        // Add the timer to our container
        container.appendChild(timerElement);
        
        console.log(`[CycleCountdown] Timer created for ${app} next to reset button`);
    }
    
    // Fetch cycle times for all tracked apps
    function fetchAllCycleTimes() {
        // First try to get data for all apps at once
        fetchAllCycleData().catch(() => {
            // If that fails, fetch individually
            trackedApps.forEach(app => {
                fetchCycleTime(app);
            });
        });
    }
    
    // Fetch cycle data for all apps at once
    function fetchAllCycleData() {
        // If already fetching, don't start another fetch
        if (isFetchingData) {
            return Promise.resolve(nextCycleTimes); // Return existing data
        }
        
        // Set the lock
        isFetchingData = true;
        
        return new Promise((resolve, reject) => {
            // Use a completely relative URL approach to avoid any subpath issues
            const url = buildUrl('./api/cycle/status');
            
            console.log(`[CycleCountdown] Fetching all cycle times from URL: ${url}`);
            
            fetch(url, {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Release the lock
                isFetchingData = false;
                
                // Check if we got valid data
                if (Object.keys(data).length === 0) {
                    // No data likely means no apps are configured yet - this is normal
                    console.log('[CycleCountdown] No cycle data available (no apps configured yet)');
                    resolve({}); // Resolve with empty data instead of rejecting
                    return;
                }
                
                let dataProcessed = false;
                
                // Process the data for each app
                for (const app in data) {
                    if (trackedApps.includes(app)) {
                        // Check if data format is valid
                        if (data[app] && data[app].next_cycle) {
                            console.log(`[CycleCountdown] Processing API data for ${app}:`, data[app]);
                            
                            // Convert ISO date string to Date object
                            const nextCycleTime = new Date(data[app].next_cycle);
                            
                            // Validate the date format first
                            if (isNaN(nextCycleTime.getTime())) {
                                console.error(`[CycleCountdown] Invalid date format for ${app}:`, data[app].next_cycle);
                                continue;
                            }
                            
                            // Skip timezone validation entirely - just use the timestamp as-is
                            // The backend sends timezone-aware timestamps that are already correct
                            console.log(`[CycleCountdown] ${app} timestamp: ${data[app].next_cycle}, parsed: ${nextCycleTime.toISOString()}`);
                            
                            // Store the next cycle time without timezone validation
                            nextCycleTimes[app] = nextCycleTime;
                            
                            // Clear any waiting state before updating
                            const timerElement = document.getElementById(`${app}CycleTimer`);
                            if (timerElement) {
                                const timerValue = timerElement.querySelector('.timer-value');
                                if (timerValue) {
                                    // Clear waiting/refreshing state
                                    timerValue.classList.remove('refreshing-state');
                                    timerValue.style.removeProperty('color');
                                }
                            }
                            
                            // Check the cyclelock field to determine if app is running
                            // Default to true if missing (Docker startup behavior)
                            const cyclelock = data[app].cyclelock !== undefined ? data[app].cyclelock : true;
                            
                            if (cyclelock) {
                                // App is running a cycle - show "Running Cycle"
                                runningCycles[app] = true;
                                const timerElement = document.getElementById(`${app}CycleTimer`);
                                if (timerElement) {
                                    const timerValue = timerElement.querySelector('.timer-value');
                                    if (timerValue) {
                                        timerValue.textContent = 'Running Cycle';
                                        timerValue.classList.remove('refreshing-state');
                                        timerValue.classList.add('running-state');
                                        timerValue.style.color = '#00ff88'; // Green for active
                                        console.log(`[CycleCountdown] ${app} cyclelock is true, showing Running Cycle`);
                                    }
                                } else {
                                    console.warn(`[CycleCountdown] Timer element not found for ${app} when trying to show Running Cycle`);
                                }
                            } else {
                                // App is waiting for next cycle - clear running state and show countdown
                                if (runningCycles[app]) {
                                    console.log(`[CycleCountdown] ${app} cyclelock is false, switching to countdown`);
                                }
                                runningCycles[app] = false;
                                // Update the timer display immediately for normal countdown
                                updateTimerDisplay(app);
                            }
                            
                            // Set up 1-second countdown interval if not already set
                            setupCountdown(app);
                            
                            dataProcessed = true;
                            console.log(`[CycleCountdown] Updated ${app} with next cycle: ${nextCycleTime.toISOString()}`);
                        } else {
                            console.warn(`[CycleCountdown] Invalid API data format for ${app}:`, data[app]);
                        }
                    } else {
                        console.log(`[CycleCountdown] Skipping ${app} - not in tracked apps list`);
                    }
                }
                
                if (dataProcessed) {
                    resolve(data);
                } else {
                    // No valid app data likely means no apps are configured yet - this is normal
                    console.log('[CycleCountdown] No configured apps found in API response');
                    resolve({}); // Resolve with empty data instead of rejecting
                }
            })
            .catch(error => {
                // Release the lock
                isFetchingData = false;
                
                // Only log errors occasionally to reduce console spam
                if (Math.random() < 0.1) { // Only log 10% of errors
                    console.warn('[CycleCountdown] Error fetching from API:', error.message); 
                }
                
                // Display waiting message in UI only if we have no existing data
                if (Object.keys(nextCycleTimes).length === 0) {
                    displayWaitingForCycle(); // Shows "Waiting for cycle..." during startup
                    reject(error);
                } else {
                    // If we have existing data, just use that
                    resolve(nextCycleTimes);
                }
            });
        });
    }
    
    // Fetch the next cycle time for a specific app
    function fetchCycleTime(app) {
        try {
            // Use a completely relative URL approach to avoid any subpath issues
            const url = buildUrl(`./api/cycle/status/${app}`);
            
            console.log(`[CycleCountdown] Fetching cycle time for ${app} from URL: ${url}`);
            
            // Use safe timeout to avoid context issues
            safeSetTimeout(() => {
                fetch(url, {
                    method: 'GET',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    if (data && data.next_cycle) {
                        // Store next cycle time
                        nextCycleTimes[app] = new Date(data.next_cycle);
                        
                        // Update timer display immediately
                        updateTimerDisplay(app);
                        
                        // Set up interval to update countdown
                        setupCountdown(app);
                    }
                })
                .catch(error => {
                    console.error(`[CycleCountdown] Error fetching cycle time for ${app}:`, error);
                    updateTimerError(app);
                });
            }, 50);
        } catch (error) {
            console.error(`[CycleCountdown] Error in fetchCycleTime for ${app}:`, error);
            updateTimerError(app);
        }
    }
    
    // Set up countdown interval for an app
    function setupCountdown(app) {
        // Clear any existing interval
        if (timerIntervals[app]) {
            clearInterval(timerIntervals[app]);
            console.log(`[CycleCountdown] Cleared existing 1-second timer for ${app}`);
        }
        
        // Set up new interval to update every second for smooth countdown
        timerIntervals[app] = setInterval(() => {
            updateTimerDisplay(app);
        }, 1000); // 1-second interval for smooth countdown
        
        console.log(`[CycleCountdown] Set up 1-second countdown timer for ${app}`);
    }
    
    // Update the timer display for an app
    function updateTimerDisplay(app) {
        const timerElement = document.getElementById(`${app}CycleTimer`);
        if (!timerElement) {
            console.warn(`[CycleCountdown] Timer element not found for ${app} - skipping display update`);
            return;
        }
        
        const timerValue = timerElement.querySelector('.timer-value');
        if (!timerValue) {
            console.warn(`[CycleCountdown] Timer value element not found for ${app} - skipping display update`);
            return;
        }
        
        // If this timer is waiting for reset data, don't update it
        if (timerElement.getAttribute('data-waiting-for-reset') === 'true') {
            return; // Keep showing "Refreshing" until reset data is available
        }
        
        // If app is marked as running a cycle, keep showing "Running Cycle"
        if (runningCycles[app]) {
            timerValue.textContent = 'Running Cycle';
            timerValue.classList.remove('refreshing-state');
            timerValue.classList.add('running-state');
            timerValue.style.color = '#00ff88'; // Green for active
            return; // Don't override with countdown
        }
        
        const nextCycleTime = nextCycleTimes[app];
        if (!nextCycleTime) {
            timerValue.textContent = '--:--:--';
            console.log(`[CycleCountdown] No next cycle time for ${app}, showing default`);
            return;
        }
        
        // Calculate time remaining
        const now = new Date();
        const timeRemaining = nextCycleTime - now;
        
        console.log(`[CycleCountdown] ${app} - Next: ${nextCycleTime.toISOString()}, Now: ${now.toISOString()}, Remaining: ${Math.floor(timeRemaining/1000)}s`);
        
        if (timeRemaining <= 0) {
            // Time has passed, clear old data and wait for API sync to correct it
            console.log(`[CycleCountdown] ${app} timer expired, clearing and waiting for API sync`);
            delete nextCycleTimes[app];
            timerValue.textContent = '--:--:--';
            timerValue.classList.remove('refreshing-state', 'running-state');
            timerValue.style.removeProperty('color');
            return;
        }
        
        // Format countdown time
        const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
        const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
        
        // Format with leading zeros
        const formattedHours = String(hours).padStart(2, '0');
        const formattedMinutes = String(minutes).padStart(2, '0');
        const formattedSeconds = String(seconds).padStart(2, '0');
        
        // Display formatted countdown
        const formattedTime = `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
        timerValue.textContent = formattedTime;
        
        // Remove refreshing and running state classes and clear any inline styles to restore proper color
        timerValue.classList.remove('refreshing-state', 'running-state');
        
        // Add visual indicator for remaining time
        updateTimerStyle(timerElement, timeRemaining);
        
        // Only log occasionally to avoid spam
        if (seconds % 10 === 0) { // Log every 10 seconds
            console.log(`[CycleCountdown] ${app} countdown: ${formattedTime}`);
        }
    }
    
    // Update timer styling based on remaining time
    function updateTimerStyle(timerElement, timeRemaining) {
        // Get the timer value element
        const timerValue = timerElement.querySelector('.timer-value');
        if (!timerValue) return;
        
        // Remove any existing time-based classes from both elements
        timerElement.classList.remove('timer-soon', 'timer-imminent', 'timer-normal');
        timerValue.classList.remove('timer-value-soon', 'timer-value-imminent', 'timer-value-normal');
        
        // Add class based on time remaining
        if (timeRemaining < 60000) { // Less than 1 minute
            timerElement.classList.add('timer-imminent');
            timerValue.classList.add('timer-value-imminent');
            timerValue.style.color = '#ff3333'; // Red - direct styling for immediate effect
        } else if (timeRemaining < 300000) { // Less than 5 minutes
            timerElement.classList.add('timer-soon');
            timerValue.classList.add('timer-value-soon');
            timerValue.style.color = '#ff8c00'; // Orange - direct styling for immediate effect
        } else {
            timerElement.classList.add('timer-normal');
            timerValue.classList.add('timer-value-normal');
            timerValue.style.color = 'white'; // White - direct styling for immediate effect
        }
    }
    
    // Show error state in timer for actual errors (not startup waiting)
    function updateTimerError(app) {
        const timerElement = document.getElementById(`${app}CycleTimer`);
        if (!timerElement) return;
        
        const timerValue = timerElement.querySelector('.timer-value');
        if (!timerValue) return;
        
        timerValue.textContent = 'Unavailable';
        timerValue.style.color = '#ff6b6b'; // Light red for actual errors
        timerElement.classList.add('timer-error');
    }
    
    // Clean up timers when page changes
    function cleanup() {
        Object.keys(timerIntervals).forEach(app => {
            clearInterval(timerIntervals[app]);
            delete timerIntervals[app];
        });
    }
    
    // Initialize on page load - with proper binding for setTimeout
    function safeSetTimeout(callback, delay) {
        // Make sure we're using the global window object for setTimeout
        return window.setTimeout.bind(window)(callback, delay);
    }
    
    function safeSetInterval(callback, delay) {
        // Make sure we're using the global window object for setInterval
        return window.setInterval.bind(window)(callback, delay);
    }
    
    document.addEventListener('DOMContentLoaded', function() {
        console.log('[CycleCountdown] DOM loaded, checking page...');
        
        // Skip initialization on login page or if not authenticated
        const isLoginPage = document.querySelector('.login-container, #loginForm, .login-form');
        if (isLoginPage) {
            console.log('[CycleCountdown] Login page detected, skipping initialization');
            return;
        }
        
        // Only initialize if we're on a page that has app status cards
        // Check for the home section or any app status elements
        const homeSection = document.getElementById('homeSection');
        const hasAppCards = document.querySelector('.app-status-card, .status-card, [id$="StatusCard"]');
        
        if (!homeSection && !hasAppCards) {
            console.log('[CycleCountdown] Not on dashboard page, skipping initialization');
            return;
        }
        
        console.log('[CycleCountdown] Dashboard page detected, initializing...');
        
        // Simple initialization with minimal delay
        setTimeout(function() {
            // Always initialize immediately on page load
            initialize();
            
            // Also set up observer for home section visibility changes
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.target.id === 'homeSection' && 
                        mutation.attributeName === 'class' && 
                        !mutation.target.classList.contains('hidden')) {
                        console.log('[CycleCountdown] Home section became visible, reinitializing...');
                        initialize();
                    } else if (mutation.target.id === 'homeSection' && 
                               mutation.attributeName === 'class' && 
                               mutation.target.classList.contains('hidden')) {
                        console.log('[CycleCountdown] Home section hidden, cleaning up...');
                        cleanup();
                    }
                }
            });
            
            if (homeSection) {
                observer.observe(homeSection, { attributes: true });
                console.log('[CycleCountdown] Observer set up for home section');
            } else {
                console.log('[CycleCountdown] Home section not found, but app cards detected');
            }
        }, 100); // 100ms delay is enough
    });
    
    // Public API
    return {
        initialize: initialize,
        fetchAllCycleTimes: fetchAllCycleTimes,
        cleanup: cleanup
    };
})();
