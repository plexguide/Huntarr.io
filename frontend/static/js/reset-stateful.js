// Direct approach: Create a new reset button next to the existing one

// Run immediately
(function() {
    // Function to create and insert our custom reset button
    function createDirectResetButton() {
        console.log('Creating direct reset button');
        
        // Check if we're on the settings page and can find the stateful header
        const statefulHeader = document.querySelector('.stateful-header-row');
        if (!statefulHeader) {
            console.log('Stateful header not found yet, waiting...');
            setTimeout(createDirectResetButton, 500);
            return;
        }
        
        // Check if we already added our button
        if (document.getElementById('direct_reset_btn')) {
            console.log('Direct reset button already exists');
            return;
        }
        
        // Create our new reset button
        const resetBtn = document.createElement('button');
        resetBtn.id = 'direct_reset_btn';
        resetBtn.className = 'danger-reset-button';
        resetBtn.innerHTML = '<i class="fas fa-trash"></i> Reset (Direct)';
        resetBtn.style.marginLeft = '5px';
        resetBtn.style.backgroundColor = '#d9534f';
        resetBtn.style.color = 'white';
        resetBtn.style.border = 'none';
        resetBtn.style.borderRadius = '4px';
        resetBtn.style.padding = '8px 15px';
        resetBtn.style.cursor = 'pointer';
        
        // Add click handler
        resetBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Direct reset button clicked!');
            
            // Ask for confirmation
            if (!confirm('Are you sure you want to reset stateful management? This will clear all processed media IDs.')) {
                return false;
            }
            
            console.log('Reset confirmed, making API call');
            
            // Show loading state
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
            
            // Make API call
            HuntarrUtils.fetchWithTimeout('./api/stateful/reset', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            .then(function(response) {
                console.log('Got response:', response.status);
                if (!response.ok) {
                    throw new Error('Server returned ' + response.status);
                }
                return response.json();
            })
            .then(function(data) {
                console.log('Reset successful!', data);
                alert('Stateful management has been reset successfully!');
                window.location.reload();
            })
            .catch(function(error) {
                console.error('Reset failed:', error);
                alert('Reset failed: ' + error.message);
                resetBtn.disabled = false;
                resetBtn.innerHTML = '<i class="fas fa-trash"></i> Reset (Direct)';
            });
            
            return false;
        };
        
        // Add the button to the page
        statefulHeader.appendChild(resetBtn);
        console.log('Direct reset button added to page!');
    }
    
    // Try to create the button immediately
    createDirectResetButton();
    
    // Also try when the page is fully loaded
    window.addEventListener('load', createDirectResetButton);
    
    // And periodically check for the stateful header
    setInterval(createDirectResetButton, 2000);
})();
