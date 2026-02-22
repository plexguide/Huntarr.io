class UserModule {
    constructor() {
        this.initializeEventListeners();
        this.loadUserData();
        this.loadAuthMode();
    }

    initializeEventListeners() {
        // Auth Mode (owner only)
        var saveAuthBtn = document.getElementById('saveAuthMode');
        if (saveAuthBtn) saveAuthBtn.addEventListener('click', () => this.saveAuthMode());
        var authSelect = document.getElementById('userAuthMode');
        if (authSelect) {
            authSelect.addEventListener('change', () => {
                var descs = { login: 'Login Mode: Standard login required for all users.', local_bypass: 'Local Bypass: No login required on local network. Remote access still requires login.', no_login: 'No Login: Authentication completely disabled. Use only behind a reverse proxy.' };
                var descEl = document.getElementById('userAuthModeDesc');
                if (descEl) descEl.textContent = descs[authSelect.value] || '';
            });
        }

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
            
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    async loadAuthMode() {
        try {
            // Check if user is owner
            const meResp = await fetch('./api/requestarr/users/me', { credentials: 'include' });
            if (!meResp.ok) return;
            const meData = await meResp.json();
            if (!meData || !meData.user || meData.user.role !== 'owner') return;

            // Owner — show the card
            var card = document.getElementById('auth-mode-card');
            if (card) card.style.display = '';

            // Load current auth mode from general settings
            const settingsResp = await fetch('./api/settings', { credentials: 'include' });
            if (!settingsResp.ok) return;
            const allSettings = await settingsResp.json();
            const general = allSettings.general || {};

            var select = document.getElementById('userAuthMode');
            if (!select) return;

            if (general.auth_mode) {
                select.value = general.auth_mode;
            } else if (general.proxy_auth_bypass) {
                select.value = 'no_login';
            } else if (general.local_access_bypass) {
                select.value = 'local_bypass';
            } else {
                select.value = 'login';
            }
            // Update description
            select.dispatchEvent(new Event('change'));
        } catch (e) {
            console.warn('Error loading auth mode:', e);
        }
    }

    async saveAuthMode() {
        var select = document.getElementById('userAuthMode');
        var statusEl = document.getElementById('authModeStatus');
        if (!select) return;

        try {
            const resp = await HuntarrUtils.fetchWithTimeout('./api/settings/general', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auth_mode: select.value })
            });
            const data = await resp.json();
            if (data && !data.error) {
                this.showStatus(statusEl, 'Authentication mode saved', 'success');
            } else {
                this.showStatus(statusEl, data.error || 'Failed to save', 'error');
            }
        } catch (e) {
            this.showStatus(statusEl, 'Failed to save authentication mode', 'error');
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

    _copyToClipboard(text, button) {
        function showCopied() {
            var originalText = button.textContent;
            button.textContent = 'Copied!';
            button.classList.add('copied');
            setTimeout(function() {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);
        }
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(showCopied).catch(function() {
                fallbackCopy(text, showCopied);
            });
        } else {
            fallbackCopy(text, showCopied);
        }
        function fallbackCopy(val, onSuccess) {
            var ta = document.createElement('textarea');
            ta.value = val;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); if (onSuccess) onSuccess(); } catch (e) {}
            document.body.removeChild(ta);
        }
    }

    copyRecoveryKey() {
        var recoveryKey = document.getElementById('recoveryKeyValue').textContent;
        var button = document.getElementById('copyRecoveryKey');
        this._copyToClipboard(recoveryKey, button);
    }

    copySecretKey(event) {
        var secretKey = document.getElementById('secretKey').textContent;
        var button = event.target;
        this._copyToClipboard(secretKey, button);
    }

    async linkPlexAccount() {
        const modal = document.getElementById('plexLinkModal');
        
        modal.style.display = 'block';
        this.setPlexLinkStatus('waiting', '<i class="fas fa-spinner spinner"></i> Preparing Plex authentication...');
        
        try {
            // Create Plex PIN with popup_mode — no forwardUrl, parent polls
            const response = await fetch('./api/auth/plex/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_mode: true, popup_mode: true })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.currentPlexPinId = data.pin_id;
                
                this.setPlexLinkStatus('waiting', '<i class="fas fa-external-link-alt"></i> A Plex window has opened. Please sign in there.');
                
                // Open Plex auth in a popup window
                const w = 600, h = 700;
                const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
                const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
                this.plexPopup = window.open(data.auth_url, 'PlexAuth', `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`);
                
                // Start polling for PIN claim
                this.startPlexPolling();
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
        // Clear any existing interval
        if (this.plexPollingInterval) {
            clearInterval(this.plexPollingInterval);
            this.plexPollingInterval = null;
        }
        
        if (!this.currentPlexPinId) {
            this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> No PIN ID available. Please try again.');
            return;
        }
        
        this.setPlexLinkStatus('waiting', '<i class="fas fa-hourglass-half"></i> Waiting for Plex authentication...');
        
        this.plexPollingInterval = setInterval(() => {
            // Update status if user closed popup manually
            if (this.plexPopup && this.plexPopup.closed) {
                this.setPlexLinkStatus('waiting', '<i class="fas fa-hourglass-half"></i> Checking if authentication completed...');
            }
            
            fetch(`./api/auth/plex/check/${this.currentPlexPinId}`)
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.claimed) {
                        this.setPlexLinkStatus('success', '<i class="fas fa-link"></i> Plex authenticated! Linking account...');
                        if (this.plexPopup && !this.plexPopup.closed) this.plexPopup.close();
                        this.stopPlexLinking();
                        this.linkWithPlexToken(data.token);
                    } else if (data.success && !data.claimed) {
                        // Still waiting — keep polling
                    } else {
                        this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Authentication check failed: ' + (data.error || 'Please try again.'));
                        this.stopPlexLinking();
                    }
                })
                .catch(error => {
                    this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Network error: Unable to verify authentication status.');
                    this.stopPlexLinking();
                });
        }, 2000);
        
        // Stop checking after 10 minutes
        setTimeout(() => {
            if (this.plexPollingInterval) {
                this.stopPlexLinking();
                this.setPlexLinkStatus('error', '<i class="fas fa-clock"></i> Authentication timeout: PIN expired after 10 minutes. Please try linking again.');
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
        if (this.plexPollingInterval) {
            clearInterval(this.plexPollingInterval);
            this.plexPollingInterval = null;
        }
        if (this.plexPopup && !this.plexPopup.closed) this.plexPopup.close();
        this.plexPopup = null;
        this.currentPlexPinId = null;
    }

    cancelPlexLink() {
        this.stopPlexLinking();
        document.getElementById('plexLinkModal').style.display = 'none';
        this.setPlexLinkStatus('waiting', '<i class="fas fa-hourglass-half"></i> Initializing Plex authentication...');
    }

    async unlinkPlexAccount() {
        const statusElement = document.getElementById('plexUnlinkStatus');
        const self = this;
        const doUnlink = async function() {
        try {
            const response = await fetch('./api/auth/plex/unlink', { 
                method: 'POST',
                credentials: 'include'
            });
            const result = await response.json();

            if (response.ok) {
                self.showStatus(statusElement, 'Plex account unlinked successfully!', 'success');
                setTimeout(() => {
                    self.updatePlexStatus(null);
                }, 1500);
            } else {
                // Check if session expired - provide actionable guidance
                if (result.session_expired) {
                    self.showStatus(statusElement, result.error || 'Session expired. Please refresh the page and log in again.', 'error');
                    // Auto-prompt user to refresh after showing message
                    setTimeout(() => {
                        if (confirm('Your session has expired. Would you like to log in again now?')) {
                            window.location.href = './logout'; // Redirect to logout which will clear session and redirect to login
                        }
                    }, 2000);
                } else {
                    self.showStatus(statusElement, result.error || 'Failed to unlink Plex account', 'error');
                }
            }
        } catch (error) {
            self.showStatus(statusElement, 'Error unlinking Plex account', 'error');
        }
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Unlink Plex Account', message: 'Are you sure you want to unlink your Plex account?', confirmLabel: 'Unlink', onConfirm: function() { doUnlink(); } });
        } else {
            if (!confirm('Are you sure you want to unlink your Plex account?')) return;
            doUnlink();
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

    showStatus(element, message, type) {
        // Cancel any previous hide timeout for this element
        if (element._statusTimeout) {
            clearTimeout(element._statusTimeout);
        }
        element.textContent = message;
        element.className = `status-message ${type}`;
        element.style.display = 'block';
        
        element._statusTimeout = setTimeout(() => {
            element.style.display = 'none';
            element._statusTimeout = null;
        }, 5000);
    }
}

// Export for use in main application
window.UserModule = UserModule; 