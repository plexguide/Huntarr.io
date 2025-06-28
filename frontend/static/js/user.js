class UserModule {
    constructor() {
        this.initializeEventListeners();
        this.loadUserData();
    }

    initializeEventListeners() {
        // Username change
        document.getElementById('saveUsername').addEventListener('click', () => this.saveUsername());
        
        // Password change
        document.getElementById('savePassword').addEventListener('click', () => this.savePassword());
        
        // Two-Factor Authentication
        document.getElementById('enableTwoFactor').addEventListener('click', () => this.enableTwoFactor());
        document.getElementById('verifyTwoFactor').addEventListener('click', () => this.verifyTwoFactor());
        document.getElementById('disableTwoFactor').addEventListener('click', () => this.disableTwoFactor());
        
        // Recovery Key
        document.getElementById('generateRecoveryKey').addEventListener('click', () => this.generateRecoveryKey());
        document.getElementById('copyRecoveryKey').addEventListener('click', () => this.copyRecoveryKey());
        
        // Plex Account
        document.getElementById('linkPlexAccount').addEventListener('click', () => this.linkPlexAccount());
        document.getElementById('unlinkPlexAccount').addEventListener('click', () => this.unlinkPlexAccount());
        document.getElementById('cancelPlexLink').addEventListener('click', () => this.cancelPlexLink());
        
        // Copy buttons for secret keys
        document.querySelectorAll('.copy-button').forEach(button => {
            if (button.id !== 'copyRecoveryKey') {
                button.addEventListener('click', (e) => this.copySecretKey(e));
            }
        });
    }

    async loadUserData() {
        try {
            // Clean up any stale localStorage flags that might interfere
            this.cleanupStaleFlags();
            
            // Load user info
            const userResponse = await fetch('./api/user/info', { credentials: 'include' });
            if (!userResponse.ok) throw new Error('Failed to fetch user data');
            
            const userData = await userResponse.json();
            
            // Update username
            document.getElementById('currentUsername').textContent = userData.username || 'Unknown';
            
            // Update 2FA status
            this.update2FAStatus(userData.is_2fa_enabled);
            
            // Load Plex status
            try {
                const plexResponse = await fetch('./api/auth/plex/status', { credentials: 'include' });
                if (plexResponse.ok) {
                    const plexData = await plexResponse.json();
                    if (plexData.success) {
                        this.updatePlexStatus(plexData);
                    } else {
                        this.updatePlexStatus(null);
                    }
                } else {
                    this.updatePlexStatus(null);
                }
            } catch (plexError) {
                console.warn('Error loading Plex status:', plexError);
                this.updatePlexStatus(null);
            }
            
            // Check if we're returning from Plex authentication
            this.checkPlexReturn();
            
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    async saveUsername() {
        const newUsername = document.getElementById('newUsername').value.trim();
        const currentPassword = document.getElementById('currentPasswordForUsernameChange').value;
        const statusElement = document.getElementById('usernameStatus');

        if (!newUsername || !currentPassword) {
            this.showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/change-username', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    username: newUsername,
                    password: currentPassword
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, 'Username updated successfully!', 'success');
                document.getElementById('currentUsername').textContent = newUsername;
                document.getElementById('newUsername').value = '';
                document.getElementById('currentPasswordForUsernameChange').value = '';
            } else {
                this.showStatus(statusElement, result.error || 'Failed to update username', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error updating username', 'error');
        }
    }

    async savePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const statusElement = document.getElementById('passwordStatus');

        if (!currentPassword || !newPassword || !confirmPassword) {
            this.showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            this.showStatus(statusElement, 'New passwords do not match', 'error');
            return;
        }

        if (newPassword.length < 6) {
            this.showStatus(statusElement, 'Password must be at least 6 characters long', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, 'Password updated successfully!', 'success');
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('confirmPassword').value = '';
            } else {
                this.showStatus(statusElement, result.error || 'Failed to update password', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error updating password', 'error');
        }
    }

    async enableTwoFactor() {
        try {
            const response = await fetch('./api/user/2fa/setup', { 
                method: 'POST',
                credentials: 'include'
            });
            const result = await response.json();

            if (response.ok) {
                document.getElementById('qrCode').src = result.qr_code_url;
                document.getElementById('secretKey').textContent = result.secret;
                
                document.getElementById('enableTwoFactorSection').style.display = 'none';
                document.getElementById('setupTwoFactorSection').style.display = 'block';
            } else {
                console.error('Failed to setup 2FA:', result.error);
            }
        } catch (error) {
            console.error('Error setting up 2FA:', error);
        }
    }

    async verifyTwoFactor() {
        const code = document.getElementById('verificationCode').value.trim();
        const statusElement = document.getElementById('verifyStatus');

        if (!code || code.length !== 6) {
            this.showStatus(statusElement, 'Please enter a valid 6-digit code', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/2fa/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ code })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, '2FA enabled successfully!', 'success');
                setTimeout(() => {
                    this.update2FAStatus(true);
                    document.getElementById('verificationCode').value = '';
                }, 1500);
            } else {
                this.showStatus(statusElement, result.error || 'Invalid verification code', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error verifying 2FA code', 'error');
        }
    }

    async disableTwoFactor() {
        const password = document.getElementById('currentPasswordFor2FADisable').value;
        const otpCode = document.getElementById('otpCodeFor2FADisable').value.trim();
        const statusElement = document.getElementById('disableStatus');

        if (!password || !otpCode) {
            this.showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/2fa/disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    password: password,
                    code: otpCode
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, '2FA disabled successfully!', 'success');
                setTimeout(() => {
                    this.update2FAStatus(false);
                    document.getElementById('currentPasswordFor2FADisable').value = '';
                    document.getElementById('otpCodeFor2FADisable').value = '';
                }, 1500);
            } else {
                this.showStatus(statusElement, result.error || 'Failed to disable 2FA', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error disabling 2FA', 'error');
        }
    }

    async generateRecoveryKey() {
        const password = document.getElementById('currentPasswordForRecovery').value;
        const twoFactorCode = document.getElementById('recoveryTwoFactorCode').value.trim();
        const statusElement = document.getElementById('recoveryStatus');

        if (!password) {
            this.showStatus(statusElement, 'Please enter your current password', 'error');
            return;
        }

        // Check if 2FA is enabled and require code
        const twoFactorElement = document.getElementById('twoFactorEnabled');
        const twoFactorEnabled = twoFactorElement && twoFactorElement.textContent.trim() === 'Enabled';
        if (twoFactorEnabled && !twoFactorCode) {
            this.showStatus(statusElement, 'Please enter your 2FA code', 'error');
            return;
        }

        try {
            const requestBody = { password };
            if (twoFactorEnabled) {
                requestBody.two_factor_code = twoFactorCode;
            }

            const response = await fetch('./auth/recovery-key/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();

            if (response.ok) {
                document.getElementById('recoveryKeyValue').textContent = result.recovery_key;
                document.getElementById('recoveryKeyDisplay').style.display = 'block';
                this.showStatus(statusElement, 'Recovery key generated successfully!', 'success');
                
                // Clear form
                document.getElementById('currentPasswordForRecovery').value = '';
                document.getElementById('recoveryTwoFactorCode').value = '';
                
                // Auto-hide after 5 minutes
                setTimeout(() => {
                    document.getElementById('recoveryKeyDisplay').style.display = 'none';
                }, 300000);
            } else {
                this.showStatus(statusElement, result.error || 'Failed to generate recovery key', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error generating recovery key', 'error');
        }
    }

    copyRecoveryKey() {
        const recoveryKey = document.getElementById('recoveryKeyValue').textContent;
        const button = document.getElementById('copyRecoveryKey');
        
        navigator.clipboard.writeText(recoveryKey).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            button.classList.add('copied');
            
            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);
        }).catch(() => {
            console.error('Failed to copy recovery key');
        });
    }

    copySecretKey(event) {
        const secretKey = document.getElementById('secretKey').textContent;
        const button = event.target;
        
        navigator.clipboard.writeText(secretKey).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            button.classList.add('copied');
            
            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);
        }).catch(() => {
            console.error('Failed to copy secret key');
        });
    }

    async linkPlexAccount() {
        const modal = document.getElementById('plexLinkModal');
        const pinCode = document.getElementById('plexLinkPinCode');
        
        modal.style.display = 'block';
        pinCode.textContent = '';
        this.setPlexLinkStatus('waiting', '<i class="fas fa-spinner spinner"></i> Preparing Plex authentication...');
        
        try {
            // Create Plex PIN with user_mode flag
            const response = await fetch('./api/auth/plex/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_mode: true })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.currentPlexPinId = data.pin_id;
                
                // Extract PIN code from auth URL
                const hashPart = data.auth_url.split('#')[1];
                if (hashPart) {
                    const urlParams = new URLSearchParams(hashPart.substring(1));
                    const pinCodeValue = urlParams.get('code');
                    pinCode.textContent = pinCodeValue || 'PIN-' + this.currentPlexPinId;
                } else {
                    pinCode.textContent = 'PIN-' + this.currentPlexPinId;
                }
                
                this.setPlexLinkStatus('waiting', '<i class="fas fa-external-link-alt"></i> You will be redirected to Plex to sign in. After authentication, you will be brought back here automatically.');
                
                // Store PIN ID and flags for when we return from Plex
                localStorage.setItem('huntarr-plex-pin-id', this.currentPlexPinId);
                localStorage.setItem('huntarr-plex-linking', 'true');
                localStorage.setItem('huntarr-plex-user-mode', 'true');
                localStorage.setItem('huntarr-plex-linking-timestamp', Date.now().toString());
                
                // Redirect to Plex authentication
                setTimeout(() => {
                    this.setPlexLinkStatus('waiting', '<i class="fas fa-spinner spinner"></i> Redirecting to Plex...');
                    setTimeout(() => {
                        window.location.href = data.auth_url;
                    }, 1000);
                }, 2000);
            } else {
                this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Failed to create Plex PIN: ' + (data.error || 'Unknown error. Please try again.'));
            }
        } catch (error) {
            console.error('Error creating Plex PIN:', error);
            this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Network error: Unable to connect to Plex. Please check your internet connection and try again.');
        }
    }

    setPlexLinkStatus(type, message) {
        const plexLinkStatus = document.getElementById('plexLinkStatus');
        
        if (plexLinkStatus) {
            plexLinkStatus.className = `plex-status ${type}`;
            plexLinkStatus.innerHTML = message;
            plexLinkStatus.style.display = 'block';
        }
    }

    startPlexPolling() {
        console.log('startPlexPinChecking called with PIN ID:', this.currentPlexPinId);
        
        // Clear any existing interval
        if (this.plexPollingInterval) {
            console.log('Clearing existing interval');
            clearInterval(this.plexPollingInterval);
            this.plexPollingInterval = null;
        }
        
        if (!this.currentPlexPinId) {
            console.error('No PIN ID available for checking');
            this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> No PIN ID available. Please try again.');
            return;
        }
        
        this.setPlexLinkStatus('waiting', '<i class="fas fa-hourglass-half"></i> Checking authentication status...');
        
        this.plexPollingInterval = setInterval(() => {
            console.log('Checking PIN status for:', this.currentPlexPinId);
            
            fetch(`./api/auth/plex/check/${this.currentPlexPinId}`)
                .then(response => {
                    console.log('PIN check response status:', response.status);
                    return response.json();
                })
                .then(data => {
                    console.log('PIN check data:', data);
                    if (data.success && data.claimed) {
                        console.log('PIN claimed, linking account');
                        this.setPlexLinkStatus('success', '<i class="fas fa-link"></i> Plex account successfully linked!');
                        this.stopPlexLinking(); // Stop checking immediately
                        this.linkWithPlexToken(data.token); // This will also call stopPlexLinking in finally
                    } else if (data.success && !data.claimed) {
                        console.log('PIN not yet claimed, continuing to check');
                        this.setPlexLinkStatus('waiting', '<i class="fas fa-hourglass-half"></i> Waiting for Plex authentication to complete...');
                    } else {
                        console.error('PIN check failed:', data);
                        this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Authentication check failed: ' + (data.error || 'Please try again.'));
                        this.stopPlexLinking();
                    }
                })
                .catch(error => {
                    console.error('Error checking PIN:', error);
                    this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Network error: Unable to verify authentication status. Please try again.');
                    this.stopPlexLinking();
                });
        }, 2000);
        
        // Stop checking after 10 minutes
        setTimeout(() => {
            if (this.plexPollingInterval) {
                console.log('PIN check timeout reached');
                this.stopPlexLinking();
                this.setPlexLinkStatus('error', '<i class="fas fa-clock"></i> Authentication timeout: PIN expired after 10 minutes. Please try linking your account again.');
            }
        }, 600000);
    }
    
    async linkWithPlexToken(token) {
        console.log('Linking with Plex token');
        this.setPlexLinkStatus('waiting', '<i class="fas fa-spinner spinner"></i> Finalizing account link...');
        
        try {
            // Use the same approach as setup - let backend get username from database
            const linkResponse = await fetch('./api/auth/plex/link', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    token: token,
                    setup_mode: true  // Use setup mode like the working implementation
                })
            });
            
            const linkResult = await linkResponse.json();
            
            if (linkResponse.ok && linkResult.success) {
                this.setPlexLinkStatus('success', '<i class="fas fa-check-circle"></i> Plex account successfully linked!');
                setTimeout(() => {
                    const modal = document.getElementById('plexLinkModal');
                    if (modal) modal.style.display = 'none';
                    
                    // Reload user data to show updated Plex status
                    this.loadUserData();
                }, 2000);
            } else {
                this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Account linking failed: ' + (linkResult.error || 'Unknown error occurred. Please try again.'));
            }
        } catch (error) {
            console.error('Error linking Plex account:', error);
            this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Network error: Unable to complete account linking. Please check your connection and try again.');
        } finally {
            // Always stop the PIN checking interval when linking completes (success or failure)
            console.log('linkWithPlexToken completed, stopping PIN checking');
            this.stopPlexLinking();
        }
    }
    
    stopPlexLinking() {
        console.log('stopPlexLinking called');
        if (this.plexPollingInterval) {
            clearInterval(this.plexPollingInterval);
            this.plexPollingInterval = null;
            console.log('Cleared PIN check interval');
        }
        this.currentPlexPinId = null;
    }

    // Add method to check for return from Plex authentication 
    checkPlexReturn() {
        const plexLinking = localStorage.getItem('huntarr-plex-linking');
        const plexPinId = localStorage.getItem('huntarr-plex-pin-id');
        const userMode = localStorage.getItem('huntarr-plex-user-mode');
        
        if (plexLinking === 'true' && plexPinId && userMode === 'true') {
            console.log('Detected return from Plex authentication, PIN ID:', plexPinId);
            
            // Clear the flags
            localStorage.removeItem('huntarr-plex-linking');
            localStorage.removeItem('huntarr-plex-pin-id');
            localStorage.removeItem('huntarr-plex-user-mode');
            localStorage.removeItem('huntarr-plex-linking-timestamp');
            
            // Show modal and start checking
            document.getElementById('plexLinkModal').style.display = 'block';
            
            // Extract PIN code for display
            const pinCodeValue = plexPinId.substring(0, 4) + '-' + plexPinId.substring(4);
            document.getElementById('plexLinkPinCode').textContent = pinCodeValue;
            
            // Set global PIN ID and start checking
            this.currentPlexPinId = plexPinId;
            this.setPlexLinkStatus('waiting', '<i class="fas fa-spinner spinner"></i> Completing Plex authentication and linking your account...');
            
            console.log('Starting PIN checking for returned user');
            this.startPlexPolling();
        }
    }

    cancelPlexLink() {
        this.stopPlexLinking();
        document.getElementById('plexLinkModal').style.display = 'none';
        this.setPlexLinkStatus('waiting', '<i class="fas fa-hourglass-half"></i> Initializing Plex authentication...');
    }

    async unlinkPlexAccount() {
        const statusElement = document.getElementById('plexUnlinkStatus');
        
        if (!confirm('Are you sure you want to unlink your Plex account?')) {
            return;
        }

        try {
            const response = await fetch('./api/auth/plex/unlink', { 
                method: 'POST',
                credentials: 'include'
            });
            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, 'Plex account unlinked successfully!', 'success');
                setTimeout(() => {
                    this.updatePlexStatus(null);
                }, 1500);
            } else {
                this.showStatus(statusElement, result.error || 'Failed to unlink Plex account', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error unlinking Plex account', 'error');
        }
    }

    update2FAStatus(enabled) {
        const statusBadge = document.getElementById('twoFactorEnabled');
        const enableSection = document.getElementById('enableTwoFactorSection');
        const setupSection = document.getElementById('setupTwoFactorSection');
        const disableSection = document.getElementById('disableTwoFactorSection');
        const recoverySection = document.getElementById('recoveryTwoFactorSection');

        statusBadge.style.display = 'inline-block';

        if (enabled) {
            statusBadge.textContent = 'Enabled';
            statusBadge.className = 'status-badge enabled';
            
            enableSection.style.display = 'none';
            setupSection.style.display = 'none';
            disableSection.style.display = 'block';
            recoverySection.style.display = 'block';
        } else {
            statusBadge.textContent = 'Disabled';
            statusBadge.className = 'status-badge disabled';
            
            enableSection.style.display = 'block';
            setupSection.style.display = 'none';
            disableSection.style.display = 'none';
            recoverySection.style.display = 'none';
        }
    }

    updatePlexStatus(plexData) {
        const statusBadge = document.getElementById('plexAccountStatus');
        const notLinkedSection = document.getElementById('plexNotLinkedSection');
        const linkedSection = document.getElementById('plexLinkedSection');

        statusBadge.style.display = 'inline-block';

        if (plexData && plexData.plex_linked) {
            statusBadge.textContent = 'Linked';
            statusBadge.className = 'status-badge enabled';
            
            document.getElementById('plexUsername').textContent = plexData.plex_username || 'Unknown';
            document.getElementById('plexEmail').textContent = plexData.plex_email || 'N/A';
            
            // Format the timestamp properly
            let linkedAtText = 'Unknown';
            if (plexData.plex_linked_at) {
                try {
                    const timestamp = plexData.plex_linked_at;
                    const date = new Date(timestamp * 1000); // Convert Unix timestamp to milliseconds
                    linkedAtText = date.toLocaleString(); // Format as readable date/time
                } catch (error) {
                    console.error('Error formatting plex_linked_at timestamp:', error);
                    linkedAtText = 'Invalid Date';
                }
            }
            document.getElementById('plexLinkedAt').textContent = linkedAtText;
            
            notLinkedSection.style.display = 'none';
            linkedSection.style.display = 'block';
        } else {
            statusBadge.textContent = 'Not Linked';
            statusBadge.className = 'status-badge disabled';
            
            notLinkedSection.style.display = 'block';
            linkedSection.style.display = 'none';
        }
    }

    cleanupStaleFlags() {
        // Clean up any localStorage flags that might interfere with normal operation
        const flagsToClean = [
            'huntarr-plex-login',
            'huntarr-plex-setup-mode'
        ];
        
        flagsToClean.forEach(flag => {
            if (localStorage.getItem(flag)) {
                console.log(`[UserModule] Cleaning up stale localStorage flag: ${flag}`);
                localStorage.removeItem(flag);
            }
        });
        
        // Only clean up Plex linking flags if they're older than 10 minutes (stale)
        const plexLinkingTimestamp = localStorage.getItem('huntarr-plex-linking-timestamp');
        if (plexLinkingTimestamp) {
            const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
            if (parseInt(plexLinkingTimestamp) < tenMinutesAgo) {
                console.log('[UserModule] Cleaning up stale Plex linking flags (older than 10 minutes)');
                localStorage.removeItem('huntarr-plex-linking');
                localStorage.removeItem('huntarr-plex-pin-id');
                localStorage.removeItem('huntarr-plex-user-mode');
                localStorage.removeItem('huntarr-plex-linking-timestamp');
            }
        }
    }

    showStatus(element, message, type) {
        element.textContent = message;
        element.className = `status-message ${type}`;
        element.style.display = 'block';
        
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }
}

// Export for use in main application
window.UserModule = UserModule; 