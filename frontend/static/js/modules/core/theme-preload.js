(function() {
    // Store logo URL consistently across the app - use local path instead of GitHub
    const LOGO_URL = './static/logo/256.png';
    
    // Create and preload image with local path
    const preloadImg = new Image();
    preloadImg.src = LOGO_URL;
    
    // Always enforce dark theme
    document.documentElement.classList.add('dark-theme');
    localStorage.setItem('huntarr-dark-mode', 'true');
    
    // Add inline style to immediately set background color
    // This prevents flash before the CSS files load
    const style = document.createElement('style');
    style.textContent = `
        body, html { 
            background-color: #1a1d24 !important; 
            color: #f8f9fa !important;
        }
        .sidebar {
            background-color: #121212 !important;
        }
        .top-bar {
            background-color: #252a34 !important;
        }
        .login-container {
            background-color: #252a34 !important;
        }
        .login-header {
            background-color: #121212 !important;
        }
    `;
    document.head.appendChild(style);
    
    // Store the logo URL in localStorage for persistence across page loads
    localStorage.setItem('huntarr-logo-url', LOGO_URL);
    
    // Create a global function to apply the logo to all logo elements
    window.applyLogoToAllElements = function() {
        const logoUrl = localStorage.getItem('huntarr-logo-url') || LOGO_URL;
        const logoElements = document.querySelectorAll('.logo, .login-logo');
        
        logoElements.forEach(img => {
            if (!img.src || img.src !== logoUrl) {
                img.src = logoUrl;
            }
            
            // Handle image load event properly
            if (img.complete) {
                img.classList.add('loaded');
            } else {
                img.onload = function() {
                    this.classList.add('loaded');
                };
                img.onerror = function() {
                    // Fallback if local path fails
                    console.warn('Logo failed to load, trying alternate source');
                    if (this.src !== './logo/256.png') {
                        this.src = './logo/256.png';
                    }
                };
            }
        });

        // Check if the logo source needs updating
        document.querySelectorAll('img[alt*="Logo"]').forEach(img => {
            // Check if the src is not the correct static path
            const currentSrc = new URL(img.src, window.location.origin).pathname;
            if (currentSrc !== LOGO_URL) {
                // Check against the old incorrect path as well, just in case
                if (currentSrc === '/logo/64.png') {
                    img.src = LOGO_URL;
                }
                // You might want to add more specific checks or broader updates here
                // For now, we only correct the specific incorrect path found
            }
        });
    };
    
    // Apply logo as soon as DOM is interactive
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.applyLogoToAllElements);
    } else {
        // DOMContentLoaded already fired
        window.applyLogoToAllElements();
    }
    
    // Set up MutationObserver to catch any dynamically added logo elements
    document.addEventListener('DOMContentLoaded', function() {
        const observer = new MutationObserver(function(mutations) {
            let shouldApplyLogos = false;
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes.length) {
                    shouldApplyLogos = true;
                }
            });
            if (shouldApplyLogos) {
                window.applyLogoToAllElements();
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
    });
    
    // Ensure logo is loaded when navigating with AJAX
    window.addEventListener('load', window.applyLogoToAllElements);
})();
