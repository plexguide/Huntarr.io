/**
 * Apps Section Scroll Fix
 * This script prevents double scrollbars and limits excessive scrolling
 * by ensuring only the main content area is scrollable
 */
document.addEventListener('DOMContentLoaded', function() {
    // Function to fix the apps section scrolling
    function fixAppsScrolling() {
        // Get the main content element (this should be the only scrollable container)
        const mainContent = document.querySelector('.main-content');
        
        // Get the apps section elements
        const appsSection = document.getElementById('appsSection');
        const singleScrollContainer = appsSection ? appsSection.querySelector('.single-scroll-container') : null;
        const appPanelsContainer = appsSection ? appsSection.querySelector('.app-panels-container') : null;
        
        // Make sure main content is the only scrollable container
        if (mainContent) {
            mainContent.style.overflowY = 'auto';
            mainContent.style.height = '100vh';
        }
        
        // If the apps section exists, make it visible but not scrollable
        if (appsSection) {
            // Remove scrolling from apps section
            appsSection.style.overflow = 'visible';
            appsSection.style.height = 'auto';
            appsSection.style.maxHeight = 'none';
            
            // Remove scrolling from single scroll container
            if (singleScrollContainer) {
                singleScrollContainer.style.overflow = 'visible';
                singleScrollContainer.style.height = 'auto';
                singleScrollContainer.style.maxHeight = 'none';
            }
            
            // Remove excessive padding from app panels container
            if (appPanelsContainer) {
                appPanelsContainer.style.height = 'auto';
                appPanelsContainer.style.overflow = 'visible';
                appPanelsContainer.style.marginBottom = '50px';
                appPanelsContainer.style.paddingBottom = '0';
            }
            
            // Remove excessive padding from all app panels
            const appPanels = document.querySelectorAll('.app-apps-panel');
            appPanels.forEach(panel => {
                panel.style.overflow = 'visible';
                panel.style.height = 'auto';
                panel.style.maxHeight = 'none';
                panel.style.paddingBottom = '50px';
                panel.style.marginBottom = '20px';
            });
            
            // Remove excessive bottom padding from additional options sections
            const additionalOptions = document.querySelectorAll('.additional-options, .skip-series-refresh');
            additionalOptions.forEach(section => {
                section.style.overflow = 'visible';
                section.style.marginBottom = '50px';
                section.style.paddingBottom = '20px';
            });
            
            // Make sure content sections are not scrollable
            const contentSections = document.querySelectorAll('.content-section');
            contentSections.forEach(section => {
                section.style.overflow = 'visible';
                section.style.height = 'auto';
            });
            
            // Make sure app container is not scrollable
            const appsContainer = document.getElementById('appsContainer');
            if (appsContainer) {
                appsContainer.style.overflow = 'visible';
                appsContainer.style.height = 'auto';
            }
        }
    }
    
    // Apply the fix immediately
    fixAppsScrolling();
    
    // Apply after a short delay to account for dynamic content
    setTimeout(fixAppsScrolling, 500);
    setTimeout(fixAppsScrolling, 1000); // Additional delayed application
    
    // Apply when app selection changes
    const appsAppSelect = document.getElementById('appsAppSelect');
    if (appsAppSelect) {
        appsAppSelect.addEventListener('change', function() {
            // Wait for panel to update
            setTimeout(fixAppsScrolling, 300);
        });
    }
    
    // Apply when window is resized
    window.addEventListener('resize', fixAppsScrolling);
    
    // Apply when hash changes (navigation)
    window.addEventListener('hashchange', function() {
        // Check if we navigated to the apps section
        setTimeout(fixAppsScrolling, 300);
    });
}); 