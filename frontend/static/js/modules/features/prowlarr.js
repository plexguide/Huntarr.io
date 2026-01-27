/**
 * Prowlarr Module
 * Handles Prowlarr-specific functionality
 */

window.HuntarrProwlarr = {
    prowlarrStatsInterval: null,
    currentIndexerStats: null,

    loadProwlarrStatus: function() {
        const prowlarrCard = document.getElementById('prowlarrStatusCard');
        if (!prowlarrCard) return;

        // First check if Prowlarr is configured and enabled
        HuntarrUtils.fetchWithTimeout('./api/prowlarr/status')
            .then(response => response.json())
            .then(statusData => {
                // Only show card if Prowlarr is configured and enabled
                if (statusData.configured && statusData.enabled) {
                    prowlarrCard.style.display = 'block';
                    
                    // Update connection status
                    const statusElement = document.getElementById('prowlarrConnectionStatus');
                    if (statusElement) {
                        if (statusData.connected) {
                            statusElement.textContent = '🟢 Connected';
                            statusElement.className = 'status-badge connected';
                        } else {
                            statusElement.textContent = '🔴 Disconnected';
                            statusElement.className = 'status-badge error';
                        }
                    }
                    
                    // Load data if connected
                    if (statusData.connected) {
                        // Load indexers quickly first
                        this.loadProwlarrIndexers();
                        // Load statistics separately (cached)
                        this.loadProwlarrStats();
                        
                        // Set up periodic refresh for statistics (every 5 minutes)
                        if (!this.prowlarrStatsInterval) {
                            this.prowlarrStatsInterval = setInterval(() => {
                                this.loadProwlarrStats();
                            }, 5 * 60 * 1000); // 5 minutes
                        }
                    } else {
                        // Show disconnected state
                        this.updateIndexersList(null, 'Prowlarr is disconnected');
                        this.updateProwlarrStatistics(null, 'Prowlarr is disconnected');
                        
                        // Clear interval if disconnected
                        if (this.prowlarrStatsInterval) {
                            clearInterval(this.prowlarrStatsInterval);
                            this.prowlarrStatsInterval = null;
                        }
                    }
                    
                } else {
                    // Hide card if not configured or disabled
                    prowlarrCard.style.display = 'none';
                    console.log('[HuntarrProwlarr] Prowlarr card hidden - configured:', statusData.configured, 'enabled:', statusData.enabled);
                }
            })
            .catch(error => {
                console.error('Error loading Prowlarr status:', error);
                // Hide card on error
                prowlarrCard.style.display = 'none';
            });
    },

    loadProwlarrIndexers: function() {
        HuntarrUtils.fetchWithTimeout('./api/prowlarr/indexers')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.indexer_details) {
                    this.updateIndexersList(data.indexer_details);
                } else {
                    console.error('Failed to load Prowlarr indexers:', data.error);
                    this.updateIndexersList(null, data.error || 'Failed to load indexers');
                }
            })
            .catch(error => {
                console.error('Error loading Prowlarr indexers:', error);
                this.updateIndexersList(null, 'Connection error');
            });
    },

    loadProwlarrStats: function() {
        HuntarrUtils.fetchWithTimeout('./api/prowlarr/stats')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.stats) {
                    this.currentIndexerStats = data.stats;
                    this.updateProwlarrStatistics(data.stats);
                } else {
                    console.error('Failed to load Prowlarr stats:', data.error);
                    this.updateProwlarrStatistics(null, data.error || 'Failed to load stats');
                }
            })
            .catch(error => {
                console.error('Error loading Prowlarr stats:', error);
                this.updateProwlarrStatistics(null, 'Connection error');
            });
    },

    updateIndexersList: function(indexerDetails, errorMessage = null) {
        const indexersList = document.getElementById('prowlarr-indexers-list');
        if (!indexersList) return;
        
        if (errorMessage) {
            indexersList.innerHTML = `<div class="loading-text" style="color: #ef4444;">${errorMessage}</div>`;
            return;
        }
        
        if (!indexerDetails || (!indexerDetails.active && !indexerDetails.throttled && !indexerDetails.failed)) {
            indexersList.innerHTML = '<div class="loading-text">No indexers configured</div>';
            return;
        }
        
        // Combine all indexers and sort alphabetically
        let allIndexers = [];
        
        if (indexerDetails.active) {
            allIndexers = allIndexers.concat(
                indexerDetails.active.map(idx => ({ ...idx, status: 'active' }))
            );
        }
        
        if (indexerDetails.throttled) {
            allIndexers = allIndexers.concat(
                indexerDetails.throttled.map(idx => ({ ...idx, status: 'throttled' }))
            );
        }
        
        if (indexerDetails.failed) {
            allIndexers = allIndexers.concat(
                indexerDetails.failed.map(idx => ({ ...idx, status: 'failed' }))
            );
        }
        
        // Sort alphabetically by name
        allIndexers.sort((a, b) => a.name.localeCompare(b.name));
        
        if (allIndexers.length === 0) {
            indexersList.innerHTML = '<div class="loading-text">No indexers found</div>';
            return;
        }
        
        // Build the HTML for indexers list with hover interactions
        const indexersHtml = allIndexers.map(indexer => {
            const statusText = indexer.status === 'active' ? 'Active' :
                             indexer.status === 'throttled' ? 'Throttled' :
                             'Failed';
            
            return `
                <div class="indexer-item" data-indexer-name="${indexer.name}">
                    <span class="indexer-name hoverable">${indexer.name}</span>
                    <span class="indexer-status ${indexer.status}">${statusText}</span>
                </div>
            `;
        }).join('');
        
        indexersList.innerHTML = indexersHtml;
        
        // Add hover event listeners to indexer names
        const indexerItems = indexersList.querySelectorAll('.indexer-item');
        indexerItems.forEach(item => {
            const indexerName = item.dataset.indexerName;
            const nameElement = item.querySelector('.indexer-name');
            
            nameElement.addEventListener('mouseenter', () => {
                this.showIndexerStats(indexerName);
                nameElement.classList.add('hovered');
            });
            
            nameElement.addEventListener('mouseleave', () => {
                this.showOverallStats();
                nameElement.classList.remove('hovered');
            });
        });
    },

    updateProwlarrStatistics: function(stats, errorMessage = null) {
        const statisticsContent = document.getElementById('prowlarr-statistics-content');
        if (!statisticsContent) return;
        
        if (errorMessage) {
            statisticsContent.innerHTML = `<div class="loading-text" style="color: #ef4444;">${errorMessage}</div>`;
            return;
        }
        
        if (!stats) {
            statisticsContent.innerHTML = '<div class="loading-text">No statistics available</div>';
            return;
        }
        
        // Store stats for hover functionality
        this.currentIndexerStats = stats;
        
        // Show overall stats by default
        this.showOverallStats();
    },

    showIndexerStats: function(indexerName) {
        if (!this.currentIndexerStats || !this.currentIndexerStats.indexers) return;
        
        const indexerStats = this.currentIndexerStats.indexers[indexerName];
        if (!indexerStats) return;
        
        const statisticsContent = document.getElementById('prowlarr-statistics-content');
        if (!statisticsContent) return;
        
        const formatNumber = window.HuntarrStats ? 
            window.HuntarrStats.formatLargeNumber.bind(window.HuntarrStats) : 
            (n => n.toLocaleString());
        
        statisticsContent.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${formatNumber(indexerStats.total_queries || 0)}</div>
                    <div class="stat-label">Total Queries</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${formatNumber(indexerStats.total_grabs || 0)}</div>
                    <div class="stat-label">Total Grabs</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${indexerStats.avg_response_time ? indexerStats.avg_response_time.toFixed(0) + 'ms' : 'N/A'}</div>
                    <div class="stat-label">Avg Response</div>
                </div>
            </div>
            <div class="indexer-name-display">${indexerName}</div>
        `;
    },

    showOverallStats: function() {
        if (!this.currentIndexerStats || !this.currentIndexerStats.overall) return;
        
        const statisticsContent = document.getElementById('prowlarr-statistics-content');
        if (!statisticsContent) return;
        
        const overall = this.currentIndexerStats.overall;
        const formatNumber = window.HuntarrStats ? 
            window.HuntarrStats.formatLargeNumber.bind(window.HuntarrStats) : 
            (n => n.toLocaleString());
        
        statisticsContent.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${formatNumber(overall.total_queries || 0)}</div>
                    <div class="stat-label">Total Queries</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${formatNumber(overall.total_grabs || 0)}</div>
                    <div class="stat-label">Total Grabs</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${overall.total_indexers || 0}</div>
                    <div class="stat-label">Total Indexers</div>
                </div>
            </div>
        `;
    },

    setupProwlarrStatusPolling: function() {
        // Load initial status
        this.loadProwlarrStatus();
        
        // Set up polling to refresh Prowlarr status every 30 seconds
        setInterval(() => {
            if (window.huntarrUI && window.huntarrUI.currentSection === 'home') {
                this.loadProwlarrStatus();
            }
        }, 30000);
    },

    initializeProwlarr: function() {
        console.log('[HuntarrProwlarr] Initializing Prowlarr section');
        
        // Load Prowlarr status when section is shown
        this.loadProwlarrStatus();
        
        // Any other Prowlarr-specific initialization
    }
};
