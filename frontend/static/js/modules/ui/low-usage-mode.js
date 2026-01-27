/**
 * Low Usage Mode Module
 * Comprehensive CPU/GPU usage reduction techniques
 * Compatible with subpath deployment
 */

// Create a global LowUsageMode namespace
window.LowUsageMode = (function() {
    // Private variables
    let isEnabled = false;
    let originalTimers = {};
    let indicator = null;
    
    // Get base URL for API calls, respecting subpath configuration
    function getBaseUrl() {
        return (window.HUNTARR_BASE_URL || '');
    }
    
    // Build a complete URL with the correct base path
    function buildUrl(path) {
        const base = getBaseUrl();
        // Make sure path starts with / if base doesn't end with /
        if (base.length > 0 && !base.endsWith('/') && !path.startsWith('/')) {
            path = '/' + path;
        }
        return base + path;
    }
    
    // Check if Low Usage Mode is enabled in settings
    function checkEnabledState() {
        const apiUrl = buildUrl('/api/settings/general');
        
        fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Cache-Control': 'no-cache'
            }
        })
        .then(response => response.json())
        .then(config => {
            if (config && config.low_usage_mode === true) {
                enable();
            } else {
                disable();
            }
        })
        .catch(error => {
            console.error('[LowUsageMode] Error checking enabled state:', error);
        });
    }
    
    // Apply all low usage optimizations
    function enable() {
        if (isEnabled) return;
        isEnabled = true;
        
        console.log('[LowUsageMode] Enabling Low Usage Mode');
        
        // 1. Apply CSS class to disable animations
        document.body.classList.add('low-usage-mode');
        document.body.classList.add('low-usage-mode-rendering-optimized');
        document.body.classList.add('low-usage-mode-layout-optimized');
        document.body.classList.add('low-usage-mode-reduced-quality');
        
        // 2. Throttle JavaScript timers
        throttleTimers();
        
        // 3. Pause video and audio elements
        pauseMediaElements();
        
        // 4. Disable WebGL and reduce canvas activity
        disableIntensiveRendering();
        
        // 5. Create visual indicator
        showIndicator();
    }
    
    // Remove all low usage optimizations
    function disable() {
        if (!isEnabled) return;
        isEnabled = false;
        
        console.log('[LowUsageMode] Disabling Low Usage Mode');
        
        // 1. Remove CSS classes
        document.body.classList.remove('low-usage-mode');
        document.body.classList.remove('low-usage-mode-rendering-optimized');
        document.body.classList.remove('low-usage-mode-layout-optimized');
        document.body.classList.remove('low-usage-mode-reduced-quality');
        
        // 2. Restore original timers
        restoreTimers();
        
        // 3. Hide indicator
        hideIndicator();
    }
    
    // Safe wrapper for setTimeout to ensure correct context
    function safeSetTimeout(callback, delay, ...args) {
        return window.setTimeout.bind(window)(callback, delay, ...args);
    }
    
    // Safe wrapper for setInterval to ensure correct context
    function safeSetInterval(callback, delay, ...args) {
        return window.setInterval.bind(window)(callback, delay, ...args);
    }
    
    // Throttle JavaScript timers to reduce CPU usage
    function throttleTimers() {
        // Only store original implementations if we haven't already
        if (!originalTimers.setTimeout) {
            originalTimers.setTimeout = window.setTimeout.bind(window);
            originalTimers.setInterval = window.setInterval.bind(window);
            
            // Override setTimeout with throttled version
            window.setTimeout = function(callback, delay, ...args) {
                // Apply minimum 1000ms (1 second) delay for non-critical timeouts
                const throttledDelay = (delay < 500 && delay > 50) ? 1000 : delay;
                return originalTimers.setTimeout(callback, throttledDelay, ...args);
            };
            
            // Override setInterval with throttled version
            window.setInterval = function(callback, delay, ...args) {
                // Apply minimum 2000ms (2 second) delay for non-critical intervals
                const throttledDelay = (delay < 1000 && delay > 100) ? 2000 : delay;
                return originalTimers.setInterval(callback, throttledDelay, ...args);
            };
        }
    }
    
    // Restore original timer implementations
    function restoreTimers() {
        if (originalTimers.setTimeout) {
            window.setTimeout = originalTimers.setTimeout;
            window.setInterval = originalTimers.setInterval;
            originalTimers = {};
        }
    }
    
    // Pause all video and audio elements
    function pauseMediaElements() {
        document.querySelectorAll('video, audio').forEach(media => {
            try {
                if (!media.paused) {
                    media.pause();
                }
            } catch (e) {
                console.error('[LowUsageMode] Error pausing media element:', e);
            }
        });
    }
    
    // Disable WebGL and reduce canvas activity
    function disableIntensiveRendering() {
        // Find all canvas elements and reduce their update frequency
        document.querySelectorAll('canvas').forEach(canvas => {
            // Mark canvas to indicate it should update less frequently
            canvas.setAttribute('data-low-usage', 'true');
        });
        
        // Attempt to disable any running requestAnimationFrame loops
        if (window.cancelAnimationFrame) {
            const originalRAF = window.requestAnimationFrame;
            window.requestAnimationFrame = function(callback) {
                // Only allow animation frames every 500ms when in low usage mode
                if (!window.lastRAFTime || (Date.now() - window.lastRAFTime > 500)) {
                    window.lastRAFTime = Date.now();
                    return originalRAF(callback);
                }
                return null;
            };
        }
    }
    
    // Remove indicator creation - Low Usage Mode runs without visual indicator
    function showIndicator() {
        // Low Usage Mode is now active without showing any visual indicator
        // This provides a cleaner interface while still applying all performance optimizations
        return;
    }
    
    // Hide the Low Usage Mode indicator
    function hideIndicator() {
        if (indicator) {
            indicator.style.display = 'none';
        }
    }
    
    // Initialize on page load
    document.addEventListener('DOMContentLoaded', function() {
        // Use a slight delay to ensure DOM is fully loaded
        safeSetTimeout(function() {
            checkEnabledState();
        }, 100);
    });
    
    // Public API
    return {
        checkEnabledState: checkEnabledState,
        enable: enable,
        disable: disable,
        isEnabled: function() { return isEnabled; }
    };
})();
