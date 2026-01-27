/**
 * Huntarr - Subtle Background Pattern
 * Adds a modern dot grid pattern to the dashboard background
 */

document.addEventListener('DOMContentLoaded', function() {
    // Add subtle background pattern styles
    const style = document.createElement('style');
    style.id = 'background-pattern-styles';
    
    // Pattern style based on the user's preference for dark themes with blue accents
    style.textContent = `
        /* Subtle dot grid pattern for dark background */
        .dashboard-grid::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-image: 
                radial-gradient(circle at 1px 1px, rgba(85, 97, 215, 0.07) 1px, transparent 0);
            background-size: 25px 25px;
            background-position: -5px -5px;
            pointer-events: none;
            z-index: 0;
            animation: patternFade 8s ease-in-out infinite alternate;
        }
        
        /* Make sure all dashboard content stays above the pattern */
        .dashboard-grid > * {
            position: relative;
            z-index: 1;
        }
        
        @keyframes patternFade {
            0% { opacity: 0.3; }
            100% { opacity: 0.8; }
        }
        
        /* For mobile - smaller pattern */
        @media (max-width: 768px) {
            .dashboard-grid::before {
                background-size: 20px 20px;
            }
        }
    `;
    
    document.head.appendChild(style);
    
    // Make sure the container has position relative for the pattern to work
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (dashboardGrid) {
        dashboardGrid.style.position = 'relative';
        dashboardGrid.style.overflow = 'hidden';
    }
});
