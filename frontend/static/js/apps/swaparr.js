// Enhanced Swaparr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const swaparrModule = {
        elements: {},
        isTableView: true, // Default to table view for Swaparr logs
        hasRenderedAnyContent: false, // Track if we've rendered any content
        
        // Store data for display with enhanced structure
        logData: {
            config: {
                platform: '',
                maxStrikes: 3,
                scanInterval: '10m',
                maxDownloadTime: '2h',
                ignoreAboveSize: '25 GB',
                dryRun: false,
                removeFromClient: true
            },
            downloads: [],  // Will store download status records
            statistics: {   // Enhanced statistics tracking
                session: {
                    total_processed: 0,
                    strikes_added: 0,
                    downloads_removed: 0,
                    items_ignored: 0,
                    api_calls_made: 0,
                    errors_encountered: 0,
                    apps_processed: [],
                    last_update: null
                },
                apps: {} // Per-app statistics
            },
            rawLogs: []     // Store raw logs for backup display
        },

        init: function() {
            console.log('[Swaparr Module] Initializing enhanced Swaparr module...');
            this.setupLogProcessor();
            this.setupEventListeners();
            
            // Try to load initial statistics
            this.loadStatistics();
        },

        setupEventListeners: function() {
            // Add a listener for when the log tab changes to Swaparr
            const swaparrTab = document.querySelector('.log-tab[data-app="swaparr"]');
            if (swaparrTab) {
                swaparrTab.addEventListener('click', () => {
                    console.log('[Swaparr Module] Swaparr tab clicked');
                    // Small delay to ensure everything is ready
                    setTimeout(() => {
                        this.ensureContentRendered();
                    }, 200);
                });
            }
        },

        setupLogProcessor: function() {
            // Setup a listener for custom event from huntarrUI's log processing
            document.addEventListener('swaparrLogReceived', (event) => {
                console.log('[Swaparr Module] Received log event:', event.detail.logData.substring(0, 100) + '...');
                this.processLogLine(event.detail.logData);
            });
        },

        loadStatistics: function() {
            // Load statistics from the API
            HuntarrUtils.fetchWithTimeout('./api/swaparr/status')
                .then(response => response.json())
                .then(data => {
                    if (data.session_statistics) {
                        this.logData.statistics.session = data.session_statistics;
                    }
                    if (data.app_statistics) {
                        this.logData.statistics.apps = data.app_statistics;
                    }
                    if (data.settings) {
                        this.updateConfigFromSettings(data.settings);
                    }
                    
                    console.log('[Swaparr Module] Loaded statistics from API');
                    
                    // Re-render if we're viewing Swaparr
                    if (app.currentLogApp === 'swaparr') {
                        this.ensureContentRendered();
                    }
                })
                .catch(error => {
                    console.warn('[Swaparr Module] Could not load statistics:', error);
                });
        },

        updateConfigFromSettings: function(settings) {
            this.logData.config.maxStrikes = settings.max_strikes || 3;
            this.logData.config.maxDownloadTime = settings.max_download_time || '2h';
            this.logData.config.ignoreAboveSize = settings.ignore_above_size || '25GB';
            this.logData.config.dryRun = settings.dry_run || false;
            this.logData.config.removeFromClient = settings.remove_from_client !== false;
        },

        processLogLine: function(logLine) {
            // Always store raw logs for backup display
            this.logData.rawLogs.push(logLine);
            
            // Limit raw logs storage to prevent memory issues
            if (this.logData.rawLogs.length > 500) {
                this.logData.rawLogs.shift();
            }
            
            // Process log lines specific to Swaparr
            if (!logLine) return;

            // Check if this looks like a Swaparr config line and extract information
            if (logLine.includes('Platform:') && logLine.includes('Max strikes:')) {
                this.extractConfigInfo(logLine);
                this.renderConfigPanel();
                return;
            }
            
            // Look for enhanced strike-related logs from system
            if (logLine.includes('Added strike') || 
                logLine.includes('Max strikes reached') || 
                logLine.includes('removing download') ||
                logLine.includes('Would have removed') ||
                logLine.includes('Successfully removed') ||
                logLine.includes('Re-removed previously removed') ||
                logLine.includes('Session stats')) {
                
                this.processStrikeLog(logLine);
                return;
            }

            // Check for session statistics updates
            if (logLine.includes('Session stats - Strikes:')) {
                this.extractSessionStats(logLine);
                this.renderStatisticsPanel();
                return;
            }

            // Check if this is a table header/separator line
            if (logLine.includes('strikes') && logLine.includes('status') && logLine.includes('name') && logLine.includes('size') && logLine.includes('eta')) {
                // This is the header line, we can ignore it or use it to confirm table format
                return;
            }

            // Try to match enhanced download info line
            const downloadLinePattern = /(\d+\/\d+)\s+(\w+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(\w+)\s+([\ddhms\s]+|Infinite)/;
            const match = logLine.match(downloadLinePattern);
            
            if (match) {
                // Extract download information
                const downloadInfo = {
                    strikes: match[1],
                    status: match[2],
                    name: match[3],
                    size: match[4] + ' ' + match[5],
                    eta: match[6],
                    timestamp: new Date().toISOString()
                };
                
                // Update or add to our list of downloads
                this.updateDownloadsList(downloadInfo);
                this.renderTableView();
            }
            
            // If we're viewing the Swaparr tab, always ensure content is rendered
            if (app.currentLogApp === 'swaparr') {
                this.ensureContentRendered();
            }
        },

        extractSessionStats: function(logLine) {
            // Extract session statistics from log line
            // Format: "Session stats - Strikes: X, Removed: Y, Ignored: Z, API calls: W"
            const strikes = logLine.match(/Strikes: (\d+)/);
            const removed = logLine.match(/Removed: (\d+)/);
            const ignored = logLine.match(/Ignored: (\d+)/);
            const apiCalls = logLine.match(/API calls: (\d+)/);
            
            if (strikes) this.logData.statistics.session.strikes_added = parseInt(strikes[1]);
            if (removed) this.logData.statistics.session.downloads_removed = parseInt(removed[1]);
            if (ignored) this.logData.statistics.session.items_ignored = parseInt(ignored[1]);
            if (apiCalls) this.logData.statistics.session.api_calls_made = parseInt(apiCalls[1]);
            
            this.logData.statistics.session.last_update = new Date().toISOString();
        },
        
        // Process enhanced strike-related logs from system logs
        processStrikeLog: function(logLine) {
            // Try to extract download name and strike info
            let downloadName = '';
            let strikes = '1/3'; // Default value
            let status = 'Striked';
            
            // Extract download name and update statistics
            if (logLine.includes('Added strike')) {
                const match = logLine.match(/Added strike \((\d+)\/(\d+)\) to (.+?) - Reason:/);
                if (match) {
                    strikes = `${match[1]}/${match[2]}`;
                    downloadName = match[3];
                    status = 'Striked';
                    this.logData.statistics.session.strikes_added++;
                }
            } else if (logLine.includes('Max strikes reached')) {
                const match = logLine.match(/Max strikes reached for (.+?), removing download/);
                if (match) {
                    downloadName = match[1];
                    status = 'Removing';
                }
            } else if (logLine.includes('Successfully removed')) {
                const match = logLine.match(/Successfully removed (.+?) after (\d+) strikes/);
                if (match) {
                    downloadName = match[1];
                    status = 'Removed';
                    strikes = `${match[2]}/3`;
                    this.logData.statistics.session.downloads_removed++;
                }
            } else if (logLine.includes('Would have removed')) {
                const match = logLine.match(/Would have removed (.+?) after (\d+) strikes/);
                if (match) {
                    downloadName = match[1];
                    status = 'Pending Removal (Dry Run)';
                    strikes = `${match[2]}/3`;
                }
            } else if (logLine.includes('Re-removed previously removed')) {
                const match = logLine.match(/Re-removed previously removed download: (.+)/);
                if (match) {
                    downloadName = match[1];
                    status = 'Re-removed';
                    this.logData.statistics.session.downloads_removed++;
                }
            }
            
            if (downloadName) {
                // Create a download info object with partial information
                const downloadInfo = {
                    strikes: strikes,
                    status: status,
                    name: downloadName,
                    size: 'Unknown',
                    eta: 'Unknown',
                    timestamp: new Date().toISOString()
                };
                
                // Update downloads list
                this.updateDownloadsList(downloadInfo);
                this.renderTableView();
                this.renderStatisticsPanel(); // Update statistics display
            }
        },

        extractConfigInfo: function(logLine) {
            // Extract the config data from the log line
            const platformMatch = logLine.match(/Platform:\s+(\w+)/);
            const maxStrikesMatch = logLine.match(/Max strikes:\s+(\d+)/);
            const scanIntervalMatch = logLine.match(/Scan interval:\s+(\d+\w+)/);
            const maxDownloadTimeMatch = logLine.match(/Max download time:\s+(\d+\w+)/);
            const ignoreSizeMatch = logLine.match(/Ignore above size:\s+(\d+\s*\w+)/);
            
            if (platformMatch) this.logData.config.platform = platformMatch[1];
            if (maxStrikesMatch) this.logData.config.maxStrikes = maxStrikesMatch[1];
            if (scanIntervalMatch) this.logData.config.scanInterval = scanIntervalMatch[1];
            if (maxDownloadTimeMatch) this.logData.config.maxDownloadTime = maxDownloadTimeMatch[1];
            if (ignoreSizeMatch) this.logData.config.ignoreAboveSize = ignoreSizeMatch[1];
        },

        updateDownloadsList: function(downloadInfo) {
            // Find if this download already exists in our list
            const existingIndex = this.logData.downloads.findIndex(item => 
                item.name.trim() === downloadInfo.name.trim()
            );
            
            if (existingIndex >= 0) {
                // Update existing entry but preserve timestamp if newer
                const existing = this.logData.downloads[existingIndex];
                this.logData.downloads[existingIndex] = {
                    ...downloadInfo,
                    first_seen: existing.first_seen || existing.timestamp || downloadInfo.timestamp
                };
            } else {
                // Add new entry
                downloadInfo.first_seen = downloadInfo.timestamp;
                this.logData.downloads.push(downloadInfo);
            }
            
            // Keep only the last 100 downloads to prevent memory issues
            if (this.logData.downloads.length > 100) {
                this.logData.downloads = this.logData.downloads.slice(-100);
            }
        },

        renderConfigPanel: function() {
            // Find the logs container
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer) return;
            
            // If the user has selected swaparr logs, show the config panel at the top
            if (app.currentLogApp === 'swaparr') {
                // Check if config panel already exists
                let configPanel = document.getElementById('swaparr-config-panel');
                if (!configPanel) {
                    // Create the panel
                    configPanel = document.createElement('div');
                    configPanel.id = 'swaparr-config-panel';
                    configPanel.classList.add('swaparr-panel');
                    logsContainer.appendChild(configPanel);
                }
                
                const dryRunBadge = this.logData.config.dryRun ? 
                    '<span class="swaparr-badge swaparr-badge-warning">DRY RUN</span>' : '';
                
                // Update the panel content with enhanced information
                configPanel.innerHTML = `
                    <div class="swaparr-config">
                        <h3>
                            <i class="fas fa-exchange-alt"></i>
                            Swaparr${this.logData.config.platform ? ' — ' + this.logData.config.platform : ''}
                            ${dryRunBadge}
                        </h3>
                        <div class="swaparr-config-content">
                            <div class="config-item">
                                <i class="fas fa-exclamation-triangle"></i>
                                <span>Max strikes: <strong>${this.logData.config.maxStrikes}</strong></span>
                            </div>
                            <div class="config-item">
                                <i class="fas fa-clock"></i>
                                <span>Max download time: <strong>${this.logData.config.maxDownloadTime}</strong></span>
                            </div>
                            <div class="config-item">
                                <i class="fas fa-weight-hanging"></i>
                                <span>Ignore above: <strong>${this.logData.config.ignoreAboveSize}</strong></span>
                            </div>
                            <div class="config-item">
                                <i class="fas fa-trash-alt"></i>
                                <span>Remove from client: <strong>${this.logData.config.removeFromClient ? 'Yes' : 'No'}</strong></span>
                            </div>
                        </div>
                    </div>
                `;
                
                this.hasRenderedAnyContent = true;
            }
        },

        renderStatisticsPanel: function() {
            // Find the logs container
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer || app.currentLogApp !== 'swaparr') return;
            
            // Check if statistics panel already exists
            let statsPanel = document.getElementById('swaparr-stats-panel');
            if (!statsPanel) {
                // Create the panel
                statsPanel = document.createElement('div');
                statsPanel.id = 'swaparr-stats-panel';
                statsPanel.classList.add('swaparr-panel');
                logsContainer.appendChild(statsPanel);
            }
            
            const stats = this.logData.statistics.session;
            const lastUpdate = stats.last_update ? 
                new Date(stats.last_update).toLocaleTimeString() : 'Never';
            
            // Generate app-specific statistics
            let appStatsHtml = '';
            for (const [appName, appStats] of Object.entries(this.logData.statistics.apps)) {
                if (appStats.error) continue;
                
                appStatsHtml += `
                    <div class="app-stat">
                        <strong>${appName.toUpperCase()}</strong>: 
                        ${appStats.currently_striked || 0} striked, 
                        ${appStats.total_removed || 0} removed
                    </div>
                `;
            }
            
            // Update the panel content
            statsPanel.innerHTML = `
                <div class="swaparr-statistics">
                    <h4><i class="fas fa-chart-line"></i> Session Statistics</h4>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <i class="fas fa-tasks"></i>
                            <span class="stat-value">${stats.total_processed || 0}</span>
                            <span class="stat-label">Processed</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-exclamation-triangle"></i>
                            <span class="stat-value">${stats.strikes_added || 0}</span>
                            <span class="stat-label">Strikes Added</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-trash-alt"></i>
                            <span class="stat-value">${stats.downloads_removed || 0}</span>
                            <span class="stat-label">Removed</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-eye-slash"></i>
                            <span class="stat-value">${stats.items_ignored || 0}</span>
                            <span class="stat-label">Ignored</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-network-wired"></i>
                            <span class="stat-value">${stats.api_calls_made || 0}</span>
                            <span class="stat-label">API Calls</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-exclamation-circle"></i>
                            <span class="stat-value">${stats.errors_encountered || 0}</span>
                            <span class="stat-label">Errors</span>
                        </div>
                    </div>
                    <div class="stats-apps">
                        ${appStatsHtml}
                    </div>
                    <div class="stats-footer">
                        <small>Last update: ${lastUpdate}</small>
                    </div>
                </div>
            `;
            
            this.hasRenderedAnyContent = true;
        },

        renderTableView: function() {
            // Find the logs container
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer || app.currentLogApp !== 'swaparr') return;
            
            // Check if table already exists
            let tableView = document.getElementById('swaparr-table-view');
            if (!tableView) {
                // Create the table
                tableView = document.createElement('div');
                tableView.id = 'swaparr-table-view';
                tableView.classList.add('swaparr-table');
                logsContainer.appendChild(tableView);
            }
            
            // Only render table if we have downloads to show
            if (this.logData.downloads.length > 0) {
                // Generate table HTML with enhanced styling
                let tableHTML = `
                    <div class="swaparr-table-header">
                        <h4><i class="fas fa-download"></i> Download Queue Status (${this.logData.downloads.length} items)</h4>
                    </div>
                    <table class="swaparr-downloads-table">
                        <thead>
                            <tr>
                                <th><i class="fas fa-exclamation-triangle"></i> Strikes</th>
                                <th><i class="fas fa-info-circle"></i> Status</th>
                                <th><i class="fas fa-file"></i> Name</th>
                                <th><i class="fas fa-weight-hanging"></i> Size</th>
                                <th><i class="fas fa-clock"></i> ETA</th>
                                <th><i class="fas fa-calendar-alt"></i> First Seen</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                
                // Sort downloads by timestamp (newest first)
                const sortedDownloads = [...this.logData.downloads].sort((a, b) => 
                    new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
                );
                
                // Add each download as a row
                sortedDownloads.forEach(download => {
                    // Apply status-specific CSS class
                    let statusClass = download.status.toLowerCase().replace(/\s+/g, '-');
                    
                    // Normalize some status values
                    if (statusClass.includes('pending')) statusClass = 'pending';
                    if (statusClass.includes('removed')) statusClass = 'removed';
                    if (statusClass.includes('striked')) statusClass = 'striked';
                    if (statusClass.includes('normal')) statusClass = 'normal';
                    if (statusClass.includes('ignored')) statusClass = 'ignored';
                    if (statusClass.includes('dry-run')) statusClass = 'dry-run';
                    
                    const firstSeen = download.first_seen ? 
                        new Date(download.first_seen).toLocaleString() : 'Unknown';
                    
                    tableHTML += `
                        <tr class="swaparr-status-${statusClass}">
                            <td><span class="strikes-badge">${download.strikes}</span></td>
                            <td><span class="status-badge status-${statusClass}">${download.status}</span></td>
                            <td title="${download.name}">${download.name}</td>
                            <td>${download.size}</td>
                            <td>${download.eta}</td>
                            <td><small>${firstSeen}</small></td>
                        </tr>
                    `;
                });
                
                tableHTML += `
                        </tbody>
                    </table>
                `;
                
                tableView.innerHTML = tableHTML;
                this.hasRenderedAnyContent = true;
            } else {
                // Show empty state
                tableView.innerHTML = `
                    <div class="swaparr-empty-state">
                        <i class="fas fa-download"></i>
                        <h4>No Downloads Tracked</h4>
                        <p>Swaparr is monitoring download queues but hasn't found any stalled downloads yet.</p>
                    </div>
                `;
                this.hasRenderedAnyContent = true;
            }
        },
        
        // Render raw logs if we don't have structured content
        renderRawLogs: function() {
            // Only show raw logs if we have no other content
            if (this.hasRenderedAnyContent) return;
            
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer || app.currentLogApp !== 'swaparr') return;
            
            // Start with a message
            const noDataMessage = document.createElement('div');
            noDataMessage.classList.add('swaparr-panel');
            noDataMessage.innerHTML = `
                <div class="swaparr-config">
                    <h3><i class="fas fa-exchange-alt"></i> Swaparr Logs</h3>
                    <p>Waiting for structured Swaparr data. Showing raw logs below:</p>
                </div>
            `;
            logsContainer.appendChild(noDataMessage);
            
            // Add raw logs
            for (const logLine of this.logData.rawLogs.slice(-50)) { // Show only last 50 lines
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.innerHTML = `<span class="log-message">${logLine}</span>`;
                
                // Basic level detection
                if (logLine.includes('ERROR')) logEntry.classList.add('log-error');
                else if (logLine.includes('WARN') || logLine.includes('WARNING')) logEntry.classList.add('log-warning');
                else if (logLine.includes('DEBUG')) logEntry.classList.add('log-debug');
                else logEntry.classList.add('log-info');
                
                logsContainer.appendChild(logEntry);
            }
            
            this.hasRenderedAnyContent = true;
        },
        
        // Make sure we display something in the Swaparr tab
        ensureContentRendered: function() {
            console.log('[Swaparr Module] Ensuring content is rendered, has content:', this.hasRenderedAnyContent);
            
            // Reset rendered flag
            this.hasRenderedAnyContent = false;
            
            // Check if we're viewing Swaparr tab
            if (app.currentLogApp !== 'swaparr') return;
            
            // Clear existing content
            const logsContainer = document.getElementById('logsContainer');
            if (logsContainer) {
                // Remove only Swaparr-specific content
                const swaparrElements = logsContainer.querySelectorAll('[id^="swaparr-"], .swaparr-panel, .swaparr-table, .swaparr-empty-state');
                swaparrElements.forEach(el => el.remove());
            }
            
            // First try to render structured content
            this.renderConfigPanel();
            this.renderStatisticsPanel();
            this.renderTableView();
            
            // If no structured content, show raw logs
            if (!this.hasRenderedAnyContent) {
                this.renderRawLogs();
            }
        },

        // Clear the data when switching log views
        clearData: function() {
            this.logData.downloads = [];
            // Keep raw logs and statistics for persistence
            this.hasRenderedAnyContent = false;
        }
    };

    // Initialize the module
    document.addEventListener('DOMContentLoaded', () => {
        swaparrModule.init();
        
        if (app) {
            app.swaparrModule = swaparrModule;
            
            // Setup a handler for when log tabs are changed
            document.querySelectorAll('.log-tab').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    // If switching to swaparr tab, make sure we render the view
                    if (e.target.getAttribute('data-app') === 'swaparr') {
                        console.log('[Swaparr Module] Swaparr tab clicked via delegation');
                        // Small delay to allow logs to load
                        setTimeout(() => {
                            swaparrModule.ensureContentRendered();
                        }, 200);
                    }
                    // If switching away from swaparr tab, clear the visual data
                    else if (app.currentLogApp === 'swaparr') {
                        swaparrModule.clearData();
                    }
                });
            });
        }
    });

})(window.huntarrUI); // Pass the global UI object 