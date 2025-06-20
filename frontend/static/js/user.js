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
            // Load user info
            const userResponse = await fetch('./api/user/info');
            if (!userResponse.ok) throw new Error('Failed to fetch user data');
            
            const userData = await userResponse.json();
            
            // Update username
            document.getElementById('currentUsername').textContent = userData.username || 'Unknown';
            
            // Update 2FA status
            this.update2FAStatus(userData.is_2fa_enabled);
            
            // Load Plex status
            try {
                const plexResponse = await fetch('./api/auth/plex/status');
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
            const response = await fetch('./api/user/2fa/setup', { method: 'POST' });
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
        try {
            const response = await fetch('./api/auth/plex/pin', { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user_mode: true
                })
            });
            const result = await response.json();

            if (response.ok) {
                // Open Plex auth URL in new window
                window.open(result.auth_url, '_blank');
                
                document.getElementById('plexLinkStatus').textContent = 'Waiting for authentication...';
                document.getElementById('plexLinkModal').style.display = 'flex';
                
                this.plexPinId = result.pin_id;
                this.startPlexPolling();
            } else {
                const statusElement = document.getElementById('plexMainPageStatus');
                this.showStatus(statusElement, result.error || 'Failed to get Plex PIN', 'error');
            }
        } catch (error) {
            const statusElement = document.getElementById('plexMainPageStatus');
            this.showStatus(statusElement, 'Error connecting to Plex', 'error');
        }
    }

    startPlexPolling() {
        this.plexPollingInterval = setInterval(async () => {
            try {
                const response = await fetch(`./api/auth/plex/check/${this.plexPinId}`, { method: 'GET' });
                const result = await response.json();

                if (response.ok && result.success && result.claimed) {
                    // PIN has been claimed, now link the account
                    document.getElementById('plexLinkStatus').textContent = 'Linking account...';
                    
                    try {
                        const linkResponse = await fetch('./api/auth/plex/link', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                token: result.token
                            })
                        });
                        
                        const linkResult = await linkResponse.json();
                        
                        if (linkResponse.ok && linkResult.success) {
                            document.getElementById('plexLinkStatus').textContent = 'Successfully linked!';
                            document.getElementById('plexLinkStatus').className = 'plex-status success';
                            
                            setTimeout(() => {
                                this.cancelPlexLink();
                                this.loadUserData(); // Refresh user data to show linked account
                            }, 2000);
                        } else {
                            document.getElementById('plexLinkStatus').textContent = linkResult.error || 'Failed to link account';
                            document.getElementById('plexLinkStatus').className = 'plex-status error';
                        }
                        
                        clearInterval(this.plexPollingInterval);
                    } catch (linkError) {
                        document.getElementById('plexLinkStatus').textContent = 'Error linking account';
                        document.getElementById('plexLinkStatus').className = 'plex-status error';
                        clearInterval(this.plexPollingInterval);
                    }
                } else if (result.error && result.error !== 'PIN not authorized yet') {
                    document.getElementById('plexLinkStatus').textContent = result.error;
                    document.getElementById('plexLinkStatus').className = 'plex-status error';
                    clearInterval(this.plexPollingInterval);
                }
            } catch (error) {
                document.getElementById('plexLinkStatus').textContent = 'Error checking authorization';
                document.getElementById('plexLinkStatus').className = 'plex-status error';
                clearInterval(this.plexPollingInterval);
            }
        }, 2000);
    }

    cancelPlexLink() {
        if (this.plexPollingInterval) {
            clearInterval(this.plexPollingInterval);
        }
        document.getElementById('plexLinkModal').style.display = 'none';
        document.getElementById('plexLinkStatus').className = 'plex-status waiting';
        document.getElementById('plexLinkStatus').textContent = 'Waiting for authentication...';
    }

    async unlinkPlexAccount() {
        const statusElement = document.getElementById('plexUnlinkStatus');
        
        if (!confirm('Are you sure you want to unlink your Plex account?')) {
            return;
        }

        try {
            const response = await fetch('./api/auth/plex/unlink', { method: 'POST' });
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
            document.getElementById('plexLinkedAt').textContent = plexData.plex_linked_at || 'Unknown';
            
            notLinkedSection.style.display = 'none';
            linkedSection.style.display = 'block';
        } else {
            statusBadge.textContent = 'Not Linked';
            statusBadge.className = 'status-badge disabled';
            
            notLinkedSection.style.display = 'block';
            linkedSection.style.display = 'none';
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