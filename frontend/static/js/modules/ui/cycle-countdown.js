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
    // Track instances that have a pending reset (show "Pending Reset" until cycle ends and sleep starts)
    const pendingResets = {};
    // Per-instance cycle activity (e.g. "Season Search (360/600)" or "Processing missing") when running
    const cycleActivities = {};
    // List of apps to track (movie_hunt first so it appears first when configured)
    const trackedApps = ['movie_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'whisparr-v3', 'eros', 'swaparr'];
    
    function getBaseUrl() {
        return (window.HUNTARR_BASE_URL || '');
    }

    function buildUrl(path) {
        const base = getBaseUrl();
        path = path.replace(/^\.\//, '');
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        return base + path;
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
        
        // Clear any existing running cycle and pending reset states
        Object.keys(runningCycles).forEach(app => {
            runningCycles[app] = false;
        });
        Object.keys(pendingResets).forEach(k => { delete pendingResets[k]; });
        
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
            
            // Set up API sync every 15 seconds so countdown appears soon after cycle ends (when backend sets next_cycle)
            refreshInterval = setInterval(() => {
                // Only refresh if not already fetching
                if (!isFetchingData) {
                    console.log('[CycleCountdown] API sync (every 15s) to maintain accuracy...');
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
            }, 15000); // API sync every 15 seconds so "Starting Cycle" updates to countdown soon after sleep starts
            
            console.log('[CycleCountdown] API sync interval started (15s) - timers run independently at 1s');
        }
        
        // Start the refresh cycle
        startRefreshInterval();
    }
    
    // Simple lock to prevent concurrent fetches
    let isFetchingData = false;
    // Poll when "Starting Cycle" is shown so countdown appears soon after sleep starts
    let startingCyclePollTimeout = null;
    let startingCyclePollAttempts = 0;
    const STARTING_CYCLE_POLL_INTERVAL_MS = 2000;
    const STARTING_CYCLE_POLL_MAX_ATTEMPTS = 15; // 2s * 15 = 30s max

    function startStartingCyclePolling() {
        if (startingCyclePollTimeout) return; // already polling
        startingCyclePollAttempts = 0;
        function poll() {
            startingCyclePollAttempts++;
            if (startingCyclePollAttempts > STARTING_CYCLE_POLL_MAX_ATTEMPTS) {
                startingCyclePollTimeout = null;
                return;
            }
            if (isFetchingData) {
                startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
                return;
            }
            console.log('[CycleCountdown] Polling for countdown (sleep just started), attempt ' + startingCyclePollAttempts);
            fetchAllCycleData()
                .then((data) => {
                    const stillStarting = data && Object.keys(data).some(app => {
                        const appData = data[app];
                        if (!appData) return false;
                        if (appData.instances) {
                            return Object.keys(appData.instances).some(instName => {
                                const inst = appData.instances[instName];
                                return inst && !inst.next_cycle && !inst.cyclelock;
                            });
                        }
                        return (appData.next_cycle == null && !appData.cyclelock);
                    });
                    if (stillStarting && startingCyclePollAttempts < STARTING_CYCLE_POLL_MAX_ATTEMPTS) {
                        startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
                    } else {
                        startingCyclePollTimeout = null;
                        if (!stillStarting) console.log('[CycleCountdown] Countdown received, stopped polling');
                    }
                })
                .catch(() => {
                    startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
                });
        }
        startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
    }

    // Track active reset polling intervals so we don't stack them
    const activeResetPolls = {};

    // Set up reset button click listeners (event delegation for dynamically cloned cards)
    function setupResetButtonListeners() {
        // Use event delegation on document so cloned per-instance cards also get handled
        document.addEventListener('click', function(e) {
            const button = e.target.matches('.cycle-reset-button') ? e.target : e.target.closest('.cycle-reset-button');
            if (!button) return;
            
            const app = button.getAttribute('data-app');
            const instanceName = button.getAttribute('data-instance-name') || null;
            if (app) {
                const key = stateKey(app, instanceName);
                console.log(`[CycleCountdown] Reset button clicked for ${key}, showing Pending Reset immediately`);
                
                // Set pending reset locally for instant UI feedback
                pendingResets[key] = true;
                
                // Update timer display immediately — shows "Pending Reset" (orange)
                updateTimerDisplay(app);
                
                // Fetch latest data after a short delay so API has recorded the reset
                setTimeout(function() {
                    fetchAllCycleData().catch(function() {});
                }, 500);
                
                // Start faster polling until reset is complete
                startResetPolling(app, instanceName);
            }
        });
    }
    
    // Poll more frequently after a reset until new data is available
    function startResetPolling(app, instanceName) {
        const key = stateKey(app, instanceName);
        
        // Clear any existing polling for this key
        if (activeResetPolls[key]) {
            clearInterval(activeResetPolls[key]);
            delete activeResetPolls[key];
        }
        
        let pollAttempts = 0;
        const maxPollAttempts = 90; // Poll for up to 3 minutes (90 * 2 seconds)
        
        const pollInterval = setInterval(() => {
            pollAttempts++;
            
            fetchAllCycleData()
                .then(() => {
                    // Reset is complete when backend says pending_reset is false
                    // and we have a new countdown time (cycle restarted and is sleeping)
                    const resetDone = !pendingResets[key];
                    const hasCountdown = !!nextCycleTimes[key];
                    const isRunning = !!runningCycles[key];
                    
                    if (resetDone && (hasCountdown || isRunning)) {
                        console.log(`[CycleCountdown] Reset complete for ${key} — ${isRunning ? 'cycle running' : 'countdown available'}`);
                        clearInterval(pollInterval);
                        delete activeResetPolls[key];
                        updateTimerDisplay(app);
                    } else if (pollAttempts % 5 === 0) {
                        // Log every 10 seconds (5 * 2s)
                        console.log(`[CycleCountdown] Waiting for reset to complete for ${key} (attempt ${pollAttempts}, pending=${!!pendingResets[key]}, countdown=${hasCountdown}, running=${isRunning})`);
                    }
                })
                .catch(() => {});
            
            if (pollAttempts >= maxPollAttempts) {
                console.log(`[CycleCountdown] Max polling attempts reached for ${key}, stopping`);
                clearInterval(pollInterval);
                delete activeResetPolls[key];
                // Clear the local pending state so normal display resumes
                pendingResets[key] = false;
                updateTimerDisplay(app);
            }
        }, 2000); // Poll every 2 seconds for fast feedback
        
        activeResetPolls[key] = pollInterval;
    }
    
    // Display initial loading message in the UI when sleep data isn't available yet
    function displayWaitingForCycle() {
        trackedApps.forEach(app => {
            if (!nextCycleTimes[app]) {
                getTimerElements(app).forEach(timerElement => {
                    const timerValue = timerElement.querySelector('.timer-value');
                    if (timerValue && (timerValue.textContent === '--:--:--' || timerValue.textContent === 'Starting Cycle')) {
                        timerValue.textContent = 'Waiting for Cycle';
                        timerValue.classList.add('refreshing-state');
                        timerValue.style.color = '#00c2ce';
                    }
                });
            }
        });
    }
    
    // Return all timer elements for an app (one per card when multiple instance cards exist)
    function getTimerElements(app) {
        return document.querySelectorAll('.app-stats-card.' + app + ' .cycle-timer');
    }
    
    // Get instance name for a timer (from reset button or card in same card); returns null for single-app (e.g. swaparr)
    function getInstanceNameForTimer(timerElement) {
        const card = timerElement.closest('.app-stats-card');
        if (!card) return null;
        const resetBtn = card.querySelector('.cycle-reset-button[data-instance-name]');
        const fromBtn = resetBtn ? resetBtn.getAttribute('data-instance-name') : null;
        const fromCard = card.getAttribute('data-instance-name');
        return fromBtn || fromCard || null;
    }
    
    // Key for per-instance state: "app" for single-app, "app-instanceName" for *arr instances
    function stateKey(app, instanceName) {
        return instanceName ? app + '-' + instanceName : app;
    }
    
    // Create timer display element in each app stats card (supports multiple instance cards)
    function createTimerElement(app) {
        console.log(`[CycleCountdown] Creating timer elements for ${app}`);
        const dataApp = app;
        const cssClass = app.replace(/-/g, '');
        
        const resetButtons = document.querySelectorAll(`button.cycle-reset-button[data-app="${dataApp}"]`);
        if (!resetButtons.length) return;
        
        resetButtons.forEach(resetButton => {
            const container = resetButton.closest('.reset-and-timer-container');
            if (container && container.querySelector('.cycle-timer')) return;
            
            const parent = resetButton.parentNode;
            const wrapper = document.createElement('div');
            wrapper.className = 'reset-and-timer-container';
            wrapper.style.display = 'flex';
            wrapper.style.justifyContent = 'space-between';
            wrapper.style.alignItems = 'center';
            wrapper.style.width = '100%';
            wrapper.style.marginTop = '8px';
            parent.insertBefore(wrapper, resetButton);
            wrapper.appendChild(resetButton);
            
            const timerElement = document.createElement('div');
            timerElement.className = 'cycle-timer inline-timer';
            timerElement.innerHTML = '<i class="fas fa-clock"></i> <span class="timer-value">Starting Cycle</span>';
            if (app === 'eros') timerElement.style.cssText = 'border-left: 2px solid #ff45b7 !important;';
            timerElement.classList.add(cssClass);
            timerElement.setAttribute('data-app-type', app);
            const timerIcon = timerElement.querySelector('i');
            if (timerIcon) timerIcon.classList.add(cssClass + '-icon');
            wrapper.appendChild(timerElement);
        });
        console.log(`[CycleCountdown] Timer(s) created for ${app} (${resetButtons.length} card(s))`);
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
                
                // Process the data for each app (per-instance for *arr, single for swaparr)
                for (const app in data) {
                    if (!trackedApps.includes(app)) {
                        console.log(`[CycleCountdown] Skipping ${app} - not in tracked apps list`);
                        continue;
                    }
                    const appData = data[app];
                    if (!appData) continue;
                    // Per-instance format: { instances: { InstanceName: { next_cycle, cyclelock, pending_reset } } }
                    if (appData.instances && typeof appData.instances === 'object') {
                        Object.keys(pendingResets).filter(function(k) { return k === app || k.startsWith(app + '-'); }).forEach(function(k) { delete pendingResets[k]; });
                        for (const instanceName in appData.instances) {
                            const inst = appData.instances[instanceName];
                            if (!inst) continue;
                            
                            const key = stateKey(app, instanceName);
                            const nextCycleTime = inst.next_cycle ? new Date(inst.next_cycle) : null;
                            
                            if (nextCycleTime && !isNaN(nextCycleTime.getTime())) {
                                nextCycleTimes[key] = nextCycleTime;
                            }
                            
                            runningCycles[key] = inst.cyclelock !== undefined ? inst.cyclelock : true;
                            pendingResets[key] = inst.pending_reset === true;
                            cycleActivities[key] = inst.cycle_activity || null;
                            dataProcessed = true;
                        }
                        runningCycles[app] = false;
                        updateTimerDisplay(app);
                        setupCountdown(app);
                        continue;
                    }
                    // Single-app format: { next_cycle, cyclelock, pending_reset }
                    if (appData.next_cycle || appData.cyclelock !== undefined) {
                        const nextCycleTime = appData.next_cycle ? new Date(appData.next_cycle) : null;
                        
                        if (nextCycleTime && !isNaN(nextCycleTime.getTime())) {
                            nextCycleTimes[app] = nextCycleTime;
                        }
                        
                        pendingResets[app] = appData.pending_reset === true;
                        const cyclelock = appData.cyclelock !== undefined ? appData.cyclelock : true;
                        runningCycles[app] = cyclelock;
                        if (cyclelock && !pendingResets[app]) {
                            getTimerElements(app).forEach(timerElement => {
                                const timerValue = timerElement.querySelector('.timer-value');
                                if (timerValue) {
                                    timerValue.textContent = 'Running Cycle';
                                    timerValue.classList.remove('refreshing-state');
                                    timerValue.classList.add('running-state');
                                    timerValue.style.color = '#00ff88';
                                }
                            });
                        } else if (pendingResets[app]) {
                            getTimerElements(app).forEach(timerElement => {
                                const timerValue = timerElement.querySelector('.timer-value');
                                if (timerValue) {
                                    timerValue.textContent = 'Pending Reset';
                                    timerValue.classList.remove('refreshing-state', 'running-state');
                                    timerValue.classList.add('pending-reset-state');
                                    timerValue.style.color = '#ffaa00';
                                }
                            });
                        } else {
                            updateTimerDisplay(app);
                        }
                        setupCountdown(app);
                        dataProcessed = true;
                    }
                }
                
                if (dataProcessed) {
                    // When any instance still has no next_cycle (shows "Starting Cycle"), poll every 2s until we get
                    // a countdown (sleep just started; backend sets next_cycle shortly)
                    const hasStartingCycleWithInstances = Object.keys(data).some(app => {
                        const appData = data[app];
                        if (!appData || !appData.instances) return false;
                        return Object.keys(appData.instances).some(instanceName => {
                            const inst = appData.instances[instanceName];
                            return inst && !inst.next_cycle && !inst.cyclelock;
                        });
                    });
                    const hasStartingCycleSingle = Object.keys(data).some(app => {
                        const appData = data[app];
                        if (!appData || appData.instances) return false;
                        return (appData.next_cycle == null && !appData.cyclelock);
                    });
                    if (hasStartingCycleWithInstances || hasStartingCycleSingle) {
                        startStartingCyclePolling();
                    }
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
    
    // Update the timer display for an app (per-instance when cards have data-instance-name)
    function updateTimerDisplay(app) {
        const timerElements = getTimerElements(app);
        if (!timerElements.length) return;
        
        const now = new Date();
        
        timerElements.forEach(timerElement => {
            const timerValue = timerElement.querySelector('.timer-value');
            if (!timerValue) return;
            
            const instanceName = getInstanceNameForTimer(timerElement);
            const key = stateKey(app, instanceName);
            const nextCycleTime = nextCycleTimes[key];
            const isRunning = runningCycles[key];
            const isPendingReset = pendingResets[key] === true;
            const timeRemaining = nextCycleTime ? (nextCycleTime - now) : 0;
            const isExpired = nextCycleTime && timeRemaining <= 0;
            
            let formattedTime = 'Starting Cycle';
            if (nextCycleTime && !isExpired && !isRunning && !isPendingReset) {
                const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
                const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
                formattedTime = String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
            }
            if (isExpired) delete nextCycleTimes[key];
            
            if (isPendingReset) {
                timerValue.textContent = 'Pending Reset';
                timerValue.classList.remove('refreshing-state', 'running-state');
                timerValue.classList.add('pending-reset-state');
                timerValue.style.color = '#ffaa00';
                return;
            }
            if (isRunning) {
                const activity = cycleActivities[key];
                timerValue.textContent = (activity && String(activity).trim()) ? activity : 'Running Cycle';
                timerValue.classList.remove('refreshing-state', 'pending-reset-state');
                timerValue.classList.add('running-state');
                timerValue.style.color = '#00ff88';
                return;
            }
            if (!nextCycleTime || isExpired) {
                timerValue.textContent = 'Starting Cycle';
                timerValue.classList.remove('refreshing-state', 'running-state', 'pending-reset-state');
                timerValue.style.removeProperty('color');
                return;
            }
            timerValue.textContent = formattedTime;
            timerValue.classList.remove('refreshing-state', 'running-state', 'pending-reset-state');
            updateTimerStyle(timerElement, timeRemaining);
        });
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
        getTimerElements(app).forEach(timerElement => {
            const timerValue = timerElement.querySelector('.timer-value');
            if (timerValue) {
                timerValue.textContent = 'Unavailable';
                timerValue.style.color = '#ff6b6b';
                timerElement.classList.add('timer-error');
            }
        });
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
    
    // Refresh all cycle data immediately (for timezone changes)
    function refreshAllData() {
        console.log('[CycleCountdown] Refreshing all cycle data for timezone change');
        fetchAllCycleData()
            .then((data) => {
                if (data && Object.keys(data).length > 0) {
                    console.log('[CycleCountdown] Data refreshed successfully for timezone change');
                } else {
                    console.log('[CycleCountdown] No apps configured during timezone refresh');
                }
            })
            .catch((error) => {
                console.warn('[CycleCountdown] Failed to refresh data for timezone change:', error.message);
            });
    }

    // Public API
    return {
        initialize: initialize,
        fetchAllCycleTimes: fetchAllCycleTimes,
        cleanup: cleanup,
        refreshAllData: refreshAllData,
        refreshTimerElements: setupTimerElements
    };
})();
