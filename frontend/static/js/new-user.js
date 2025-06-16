/**
 * Huntarr - User Settings Page
 * Handles user profile management functionality
 */

// Immediately execute this function to avoid global scope pollution
(function() {
    // Wait for the DOM to be fully loaded
    document.addEventListener('DOMContentLoaded', function() {
        console.log('User settings page loaded');
        
        // Initialize user settings functionality
        initUserPage();
        
        // Setup button handlers
        setupEventHandlers();
    });
    
    function initUserPage() {
        // Set active nav item
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => item.classList.remove('active'));
        const userNav = document.getElementById('userNav');
        if (userNav) userNav.classList.add('active');
        
        const pageTitleElement = document.getElementById('currentPageTitle');
        if (pageTitleElement) pageTitleElement.textContent = 'User Settings';
        
        // Apply dark mode
        document.body.classList.add('dark-theme');
        localStorage.setItem('huntarr-dark-mode', 'true');
        
        // Fetch user data
        fetchUserInfo();
    }
    
    // Setup all event handlers for the page
    function setupEventHandlers() {
        // Change username handler
        const saveUsernameBtn = document.getElementById('saveUsername');
        if (saveUsernameBtn) {
            saveUsernameBtn.addEventListener('click', handleUsernameChange);
        }
        
        // Change password handler
        const savePasswordBtn = document.getElementById('savePassword');
        if (savePasswordBtn) {
            savePasswordBtn.addEventListener('click', handlePasswordChange);
        }
        
        // 2FA handlers
        const enableTwoFactorBtn = document.getElementById('enableTwoFactor');
        if (enableTwoFactorBtn) {
            enableTwoFactorBtn.addEventListener('click', handleEnableTwoFactor);
        }
        
        const verifyTwoFactorBtn = document.getElementById('verifyTwoFactor');
        if (verifyTwoFactorBtn) {
            verifyTwoFactorBtn.addEventListener('click', handleVerifyTwoFactor);
        }
        
        const disableTwoFactorBtn = document.getElementById('disableTwoFactor');
        if (disableTwoFactorBtn) {
            disableTwoFactorBtn.addEventListener('click', handleDisableTwoFactor);
        }
    }
    
    // Username change handler
    function handleUsernameChange() {
        const newUsername = document.getElementById('newUsername').value.trim();
        const currentPassword = document.getElementById('currentPasswordForUsernameChange').value;
        const statusElement = document.getElementById('usernameStatus');
        
        if (!newUsername || !currentPassword) {
            showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }
        
        // Min username length check
        if (newUsername.length < 3) {
            showStatus(statusElement, 'Username must be at least 3 characters long', 'error');
            return;
        }
        
        HuntarrUtils.fetchWithTimeout('./api/user/change-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: newUsername,
                password: currentPassword
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showStatus(statusElement, 'Username updated successfully', 'success');
                // Update displayed username
                updateUsernameElements(newUsername);
                // Clear form fields
                document.getElementById('newUsername').value = '';
                document.getElementById('currentPasswordForUsernameChange').value = '';
            } else {
                showStatus(statusElement, data.error || 'Failed to update username', 'error');
            }
        })
        .catch(error => {
            console.error('Error updating username:', error);
            showStatus(statusElement, 'Error updating username: ' + error.message, 'error');
        });
    }
    
    // Password change handler
    function handlePasswordChange() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const statusElement = document.getElementById('passwordStatus');
        
        if (!currentPassword || !newPassword || !confirmPassword) {
            showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showStatus(statusElement, 'New passwords do not match', 'error');
            return;
        }
        
        // Validate password (using function from user.html)
        const passwordError = validatePassword(newPassword);
        if (passwordError) {
            showStatus(statusElement, passwordError, 'error');
            return;
        }
        
        HuntarrUtils.fetchWithTimeout('./api/user/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showStatus(statusElement, 'Password updated successfully', 'success');
                // Clear form fields
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('confirmPassword').value = '';
            } else {
                showStatus(statusElement, data.error || 'Failed to update password', 'error');
            }
        })
        .catch(error => {
            console.error('Error updating password:', error);
            showStatus(statusElement, 'Error updating password: ' + error.message, 'error');
        });
    }
    
    // 2FA setup handler
    function handleEnableTwoFactor() {
        HuntarrUtils.fetchWithTimeout('./api/user/2fa/setup', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update QR code and secret
                const qrCodeImg = document.getElementById('qrCode');
                if (qrCodeImg) {
                    qrCodeImg.src = data.qr_code_url;
                }
                
                const secretKeyElement = document.getElementById('secretKey');
                if (secretKeyElement) {
                    secretKeyElement.textContent = data.secret;
                }
                
                // Show setup section
                updateVisibility('enableTwoFactorSection', false);
                updateVisibility('setupTwoFactorSection', true);
            } else {
                console.error('Failed to setup 2FA:', data.error);
                alert('Failed to setup 2FA: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error setting up 2FA:', error);
            alert('Error setting up 2FA: ' + error.message);
        });
    }
    
    // 2FA verification handler
    function handleVerifyTwoFactor() {
        const code = document.getElementById('verificationCode').value;
        const verifyStatusElement = document.getElementById('verifyStatus');
        
        if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
            showStatus(verifyStatusElement, 'Please enter a valid 6-digit verification code', 'error');
            return;
        }
        
        HuntarrUtils.fetchWithTimeout('./api/user/2fa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showStatus(verifyStatusElement, '2FA enabled successfully', 'success');
                // Update UI state
                setTimeout(() => {
                    update2FAStatus(true);
                    document.getElementById('verificationCode').value = '';
                }, 1500); // Short delay to allow user to see success message
            } else {
                showStatus(verifyStatusElement, data.error || 'Invalid verification code', 'error');
            }
        })
        .catch(error => {
            console.error('Error verifying 2FA:', error);
            showStatus(verifyStatusElement, 'Error verifying code: ' + error.message, 'error');
        });
    }
    
    // 2FA disable handler
    function handleDisableTwoFactor() {
        const password = document.getElementById('currentPasswordFor2FADisable').value;
        const otpCode = document.getElementById('otpCodeFor2FADisable').value;
        const disableStatusElement = document.getElementById('disableStatus');
        
        if (!password) {
            showStatus(disableStatusElement, 'Please enter your current password', 'error');
            return;
        }
        
        if (!otpCode || otpCode.length !== 6 || !/^\d{6}$/.test(otpCode)) {
            showStatus(disableStatusElement, 'Please enter a valid 6-digit verification code', 'error');
            return;
        }
        
        HuntarrUtils.fetchWithTimeout('./api/user/2fa/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                password: password,
                code: otpCode
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showStatus(disableStatusElement, '2FA disabled successfully', 'success');
                // Update UI state
                setTimeout(() => {
                    update2FAStatus(false);
                    document.getElementById('currentPasswordFor2FADisable').value = '';
                    document.getElementById('otpCodeFor2FADisable').value = '';
                }, 1500); // Short delay to allow user to see success message
            } else {
                showStatus(disableStatusElement, data.error || 'Failed to disable 2FA', 'error');
            }
        })
        .catch(error => {
            console.error('Error disabling 2FA:', error);
            showStatus(disableStatusElement, 'Error disabling 2FA: ' + error.message, 'error');
        });
    }
    
    // Helper function for validation
    function validatePassword(password) {
        // Only check for minimum length of 8 characters
        if (password.length < 8) {
            return 'Password must be at least 8 characters long.';
        }
        return null; // Password is valid
    }
    
    // Helper function to show status messages
    function showStatus(element, message, type) {
        if (!element) return;
        
        element.textContent = message;
        element.className = type === 'success' ? 'status-success' : 'status-error';
        element.style.display = 'block';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }
    
    // Function to fetch user information
    function fetchUserInfo() {
        HuntarrUtils.fetchWithTimeout('./api/user/info')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Update username elements
                updateUsernameElements(data.username);
                
                // Update 2FA status
                update2FAStatus(data.is_2fa_enabled);
            })
            .catch(error => {
                console.error('Error loading user info:', error);
                // Show error state in the UI
                showErrorState();
            });
    }
    
    // Helper functions
    function updateUsernameElements(username) {
        if (!username) return;
        
        const usernameElements = [
            document.getElementById('username'),
            document.getElementById('currentUsername')
        ];
        
        usernameElements.forEach(element => {
            if (element) {
                element.textContent = username;
            }
        });
    }
    
    function update2FAStatus(isEnabled) {
        const statusElement = document.getElementById('twoFactorEnabled');
        if (statusElement) {
            statusElement.textContent = isEnabled ? 'Enabled' : 'Disabled';
        }
        
        // Update visibility of relevant sections
        updateVisibility('enableTwoFactorSection', !isEnabled);
        updateVisibility('setupTwoFactorSection', false);
        updateVisibility('disableTwoFactorSection', isEnabled);
    }
    
    function updateVisibility(elementId, isVisible) {
        const element = document.getElementById(elementId);
        if (element) {
            element.style.display = isVisible ? 'block' : 'none';
        }
    }
    
    function showErrorState() {
        const usernameElement = document.getElementById('currentUsername');
        if (usernameElement) {
            usernameElement.textContent = 'Error loading username';
        }
        
        const statusElement = document.getElementById('twoFactorEnabled');
        if (statusElement) {
            statusElement.textContent = 'Error loading status';
        }
    }
})();
