/**
 * Instances Module
 * Handles adding, removing, and testing application instances
 */

window.HuntarrInstances = {
    setupInstanceEventHandlers: function() {
        const settingsPanels = document.querySelectorAll('.app-settings-panel');
        settingsPanels.forEach(panel => {
            panel.addEventListener('addInstance', (e) => this.addAppInstance(e.detail.appName));
            panel.addEventListener('removeInstance', (e) => this.removeAppInstance(e.detail.appName, e.detail.instanceId));
            panel.addEventListener('testConnection', (e) => this.testInstanceConnection(e.detail.appName, e.detail.instanceId, e.detail.url, e.detail.apiKey));
        });
    },
    
    addAppInstance: function(appName) {
        const container = document.getElementById(`${appName}Settings`);
        if (!container || !window.huntarrUI) return;
        
        const currentSettings = window.huntarrUI.getFormSettings(appName);
        if (!currentSettings.instances) currentSettings.instances = [];
        
        if (currentSettings.instances.length >= 9) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Maximum of 9 instances allowed', 'error');
            return;
        }
        
        currentSettings.instances.push({
            name: `Instance ${currentSettings.instances.length + 1}`,
            api_url: '',
            api_key: '',
            enabled: true
        });
        
        if (typeof SettingsForms !== 'undefined') {
            const formFunc = SettingsForms[`generate${appName.charAt(0).toUpperCase()}${appName.slice(1)}Form`];
            if (typeof formFunc === 'function') formFunc(container, currentSettings);
            if (typeof SettingsForms.updateDurationDisplay === 'function') SettingsForms.updateDurationDisplay();
        }
        
        if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('New instance added', 'success');
    },
    
    removeAppInstance: function(appName, instanceId) {
        const container = document.getElementById(`${appName}Settings`);
        if (!container || !window.huntarrUI) return;
        
        const currentSettings = window.huntarrUI.getFormSettings(appName);
        if (currentSettings.instances && instanceId >= 0 && instanceId < currentSettings.instances.length) {
            if (currentSettings.instances.length > 1) {
                const removedName = currentSettings.instances[instanceId].name;
                currentSettings.instances.splice(instanceId, 1);
                
                if (typeof SettingsForms !== 'undefined') {
                    const formFunc = SettingsForms[`generate${appName.charAt(0).toUpperCase()}${appName.slice(1)}Form`];
                    if (typeof formFunc === 'function') formFunc(container, currentSettings);
                    if (typeof SettingsForms.updateDurationDisplay === 'function') SettingsForms.updateDurationDisplay();
                }
                
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(`Instance "${removedName}" removed`, 'info');
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Cannot remove the last instance', 'error');
            }
        }
    },
    
    testInstanceConnection: function(appName, instanceId, url, apiKey) {
        instanceId = parseInt(instanceId, 10);
        const statusSpan = document.getElementById(`${appName}_instance_${instanceId}_status`);
        if (!statusSpan) return;
        
        statusSpan.textContent = 'Testing...';
        statusSpan.className = 'connection-status testing';
        
        if (!url || !apiKey) {
            statusSpan.textContent = 'Missing URL or API key';
            statusSpan.className = 'connection-status error';
            return;
        }
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            statusSpan.textContent = 'URL must start with http:// or https://';
            statusSpan.className = 'connection-status error';
            return;
        }
        
        const cleanUrl = window.HuntarrHelpers ? window.HuntarrHelpers.cleanUrlString(url) : url.trim();
        
        HuntarrUtils.fetchWithTimeout(`./api/${appName}/test-connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_url: cleanUrl, api_key: apiKey })
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(errorData => {
                    throw new Error(errorData.message || this.getConnectionErrorMessage(response.status));
                }).catch(() => {
                    throw new Error(this.getConnectionErrorMessage(response.status));
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                statusSpan.textContent = data.message || 'Connected';
                if (data.version) statusSpan.textContent += ` (v${data.version})`;
                statusSpan.className = 'connection-status success';
            } else {
                statusSpan.textContent = data.message || 'Failed';
                statusSpan.className = 'connection-status error';
            }
        })
        .catch(error => {
            console.error(`[HuntarrInstances] Error testing connection:`, error);
            let msg = error.message || 'Unknown error';
            if (msg.includes('Name or service not known')) msg = 'Unable to resolve hostname';
            else if (msg.includes('Connection refused')) msg = 'Connection refused';
            else if (msg.includes('timeout')) msg = 'Connection timed out';
            else if (msg.includes('401')) msg = 'Invalid API key';
            else if (msg.includes('404')) msg = 'URL endpoint not found';
            
            statusSpan.textContent = msg;
            statusSpan.className = 'connection-status error';
        });
    },
    
    getConnectionErrorMessage: function(status) {
        const errors = {
            400: 'Invalid request',
            401: 'Invalid API key',
            403: 'Access forbidden',
            404: 'Service not found',
            500: 'Server error',
            502: 'Bad gateway',
            503: 'Service unavailable',
            504: 'Gateway timeout'
        };
        return errors[status] || `Connection error (${status})`;
    }
};
