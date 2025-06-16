/**
 * Huntarr - User Settings Page
 * Handles user profile management functionality
 */

document.addEventListener('DOMContentLoaded', function() {
    // This file serves as a placeholder for any additional user management 
    // functionality that might be needed in the future
    
    console.log('User settings page loaded');
    
    // Most of the user functionality is implemented inline in the HTML page
    // The following functions could be moved here in the future:
    
    // Function to load user information
    function loadUserInfo() {
        HuntarrUtils.fetchWithTimeout('./api/user/info')
            .then(response => response.json())
            .then(data => {
                if (data.username) {
                    document.getElementById('username').textContent = data.username;
                    document.getElementById('currentUsername').value = data.username;
                }
            })
            .catch(error => console.error('Error loading user info:', error));
    }
    
    // Function to check 2FA status
    function check2FAStatus() {
        HuntarrUtils.fetchWithTimeout('./api/user/2fa-status')
            .then(response => response.json())
            .then(data => {
                const enable2FACheckbox = document.getElementById('enable2FA');
                const setup2FAContainer = document.getElementById('setup2FAContainer');
                const remove2FAContainer = document.getElementById('remove2FAContainer');
                
                if (data.enabled) {
                    enable2FACheckbox.checked = true;
                    setup2FAContainer.style.display = 'none';
                    remove2FAContainer.style.display = 'block';
                } else {
                    enable2FACheckbox.checked = false;
                    setup2FAContainer.style.display = 'none';
                    remove2FAContainer.style.display = 'none';
                }
            })
            .catch(error => console.error('Error checking 2FA status:', error));
    }
    
    // Call these functions if needed
    // loadUserInfo();
    // check2FAStatus();
});
