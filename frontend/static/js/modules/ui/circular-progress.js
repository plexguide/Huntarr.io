/**
 * Huntarr - Circular Progress Indicators
 * Creates animated circular progress indicators for API usage counters
 */

document.addEventListener('DOMContentLoaded', function() {
    // Create and inject SVG progress indicators for API counts
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];
    
    // App-specific colors matching your existing design
    const appColors = {
        'sonarr': '#3498db',  // Blue
        'radarr': '#f39c12',  // Yellow/orange
        'lidarr': '#2ecc71',  // Green
        'readarr': '#e74c3c', // Red
        'whisparr': '#9b59b6', // Purple
        'eros': '#1abc9c'     // Teal
    };
    
    // Add circular progress indicators to each API count indicator
    apps.forEach(app => {
        const capContainer = document.querySelector(`#${app}-hourly-cap`);
        if (!capContainer) return;
        
        // Get current API count and limit
        const countElement = document.querySelector(`#${app}-api-count`);
        const limitElement = document.querySelector(`#${app}-api-limit`);
        
        if (!countElement || !limitElement) return;
        
        const count = parseInt(countElement.textContent);
        const limit = parseInt(limitElement.textContent);
        
        // Create SVG container for progress circle
        const svgSize = 28;
        const circleRadius = 10;
        const circleStrokeWidth = 2.5;
        const circumference = 2 * Math.PI * circleRadius;
        
        // Calculate progress percentage
        const percentage = Math.min(count / limit, 1);
        const dashOffset = circumference * (1 - percentage);
        
        // Create SVG element
        const svgNamespace = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNamespace, "svg");
        svg.setAttribute("width", svgSize);
        svg.setAttribute("height", svgSize);
        svg.setAttribute("viewBox", `0 0 ${svgSize} ${svgSize}`);
        svg.classList.add("api-progress-circle");
        
        // Background circle
        const bgCircle = document.createElementNS(svgNamespace, "circle");
        bgCircle.setAttribute("cx", svgSize / 2);
        bgCircle.setAttribute("cy", svgSize / 2);
        bgCircle.setAttribute("r", circleRadius);
        bgCircle.setAttribute("fill", "none");
        bgCircle.setAttribute("stroke", "rgba(255, 255, 255, 0.1)");
        bgCircle.setAttribute("stroke-width", circleStrokeWidth);
        
        // Progress circle
        const progressCircle = document.createElementNS(svgNamespace, "circle");
        progressCircle.setAttribute("cx", svgSize / 2);
        progressCircle.setAttribute("cy", svgSize / 2);
        progressCircle.setAttribute("r", circleRadius);
        progressCircle.setAttribute("fill", "none");
        progressCircle.setAttribute("stroke", appColors[app]);
        progressCircle.setAttribute("stroke-width", circleStrokeWidth);
        progressCircle.setAttribute("stroke-dasharray", circumference);
        progressCircle.setAttribute("stroke-dashoffset", dashOffset);
        progressCircle.setAttribute("transform", `rotate(-90 ${svgSize/2} ${svgSize/2})`);
        
        // Add circles to SVG
        svg.appendChild(bgCircle);
        svg.appendChild(progressCircle);
        
        // Add SVG before text content
        capContainer.insertBefore(svg, capContainer.firstChild);
        
        // Style for the indicator
        const style = document.createElement('style');
        style.textContent = `
            .api-progress-circle {
                margin-right: 5px;
                filter: drop-shadow(0 0 3px ${appColors[app]}40);
            }
            
            .hourly-cap-status {
                display: flex;
                align-items: center;
            }
            
            @keyframes pulse-${app} {
                0% { filter: drop-shadow(0 0 3px ${appColors[app]}40); }
                50% { filter: drop-shadow(0 0 6px ${appColors[app]}80); }
                100% { filter: drop-shadow(0 0 3px ${appColors[app]}40); }
            }
            
            .api-progress-circle circle:nth-child(2) {
                animation: pulse-${app} 2s infinite;
                transition: stroke-dashoffset 0.5s ease;
            }
        `;
        document.head.appendChild(style);
        
        // Update progress when API counts change
        const updateProgressCircle = () => {
            const newCount = parseInt(countElement.textContent);
            const newLimit = parseInt(limitElement.textContent);
            const newPercentage = Math.min(newCount / newLimit, 1);
            const newDashOffset = circumference * (1 - newPercentage);
            
            progressCircle.setAttribute("stroke-dashoffset", newDashOffset);
            
            // Change color based on usage percentage
            if (newPercentage > 0.9) {
                progressCircle.setAttribute("stroke", "#e74c3c"); // Red when near limit
            } else if (newPercentage > 0.75) {
                progressCircle.setAttribute("stroke", "#f39c12"); // Orange/yellow for moderate usage
            } else {
                progressCircle.setAttribute("stroke", appColors[app]); // Default color
            }
        };
        
        // Set up a mutation observer to watch for changes in the count value
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'characterData' || mutation.type === 'childList') {
                    updateProgressCircle();
                }
            });
        });
        
        // Observe both count and limit elements
        observer.observe(countElement, { characterData: true, childList: true, subtree: true });
        observer.observe(limitElement, { characterData: true, childList: true, subtree: true });
    });
});
