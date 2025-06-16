/**
 * Huntarr - History Module
 * Handles displaying and managing history entries for all media apps
 */

const historyModule = {
    // State
    currentApp: 'all',
    currentPage: 1,
    totalPages: 1,
    pageSize: 20,
    searchQuery: '',
    isLoading: false,
    
    // Cache for instance settings to avoid repeated API calls
    instanceSettingsCache: {},
    
    // DOM elements
    elements: {},
    
    // Initialize the history module
    init: function() {
        this.cacheElements();
        this.setupEventListeners();
        
        // Initial load if history is active section
        if (huntarrUI && huntarrUI.currentSection === 'history') {
            this.loadHistory();
        }
    },
    
    // Cache DOM elements
    cacheElements: function() {
        this.elements = {
            // History dropdown
            historyOptions: document.querySelectorAll('.history-option'),
            currentHistoryApp: document.getElementById('current-history-app'),
            historyDropdownBtn: document.querySelector('.history-dropdown-btn'),
            historyDropdownContent: document.querySelector('.history-dropdown-content'),
            
            // Table and containers
            historyTable: document.querySelector('.history-table'),
            historyTableBody: document.getElementById('historyTableBody'),
            historyContainer: document.querySelector('.history-container'),
            
            // Controls
            historySearchInput: document.getElementById('historySearchInput'),
            historySearchButton: document.getElementById('historySearchButton'),
            historyPageSize: document.getElementById('historyPageSize'),
            clearHistoryButton: document.getElementById('clearHistoryButton'),
            
            // Pagination
            historyPrevPage: document.getElementById('historyPrevPage'),
            historyNextPage: document.getElementById('historyNextPage'),
            historyCurrentPage: document.getElementById('historyCurrentPage'),
            historyTotalPages: document.getElementById('historyTotalPages'),
            
            // State displays
            historyEmptyState: document.getElementById('historyEmptyState'),
            historyLoading: document.getElementById('historyLoading')
        };
    },
    
    // Set up event listeners
    setupEventListeners: function() {
        // App selection (native select)
        const historyAppSelect = document.getElementById('historyAppSelect');
        if (historyAppSelect) {
            historyAppSelect.addEventListener('change', (e) => {
                this.handleHistoryAppChange(e.target.value);
            });
        }
        // App selection (legacy click)
        this.elements.historyOptions.forEach(option => {
            option.addEventListener('click', e => this.handleHistoryAppChange(e));
        });
        
        // Search
        this.elements.historySearchButton.addEventListener('click', () => this.handleSearch());
        this.elements.historySearchInput.addEventListener('keypress', e => {
            if (e.key === 'Enter') this.handleSearch();
        });
        
        // Page size
        this.elements.historyPageSize.addEventListener('change', () => this.handlePageSizeChange());
        
        // Clear history
        this.elements.clearHistoryButton.addEventListener('click', () => this.handleClearHistory());
        
        // Pagination
        this.elements.historyPrevPage.addEventListener('click', () => this.handlePagination('prev'));
        this.elements.historyNextPage.addEventListener('click', () => this.handlePagination('next'));
    },
    
    // Load history data when section becomes active
    loadHistory: function() {
        if (this.elements.historyContainer) {
            this.fetchHistoryData();
        }
    },
    
    // Handle app selection changes
    handleHistoryAppChange: function(eOrValue) {
        let selectedApp;
        if (typeof eOrValue === 'string') {
            selectedApp = eOrValue;
        } else if (eOrValue && eOrValue.target) {
            selectedApp = eOrValue.target.getAttribute('data-app');
            eOrValue.preventDefault();
        }
        if (!selectedApp || selectedApp === this.currentApp) return;
        // Update UI (for legacy click)
        if (this.elements.historyOptions) {
            this.elements.historyOptions.forEach(option => {
                option.classList.remove('active');
                if (option.getAttribute('data-app') === selectedApp) {
                    option.classList.add('active');
                }
            });
        }
        // Update dropdown text (if present)
        if (this.elements.currentHistoryApp) {
            const displayName = selectedApp.charAt(0).toUpperCase() + selectedApp.slice(1);
            this.elements.currentHistoryApp.textContent = displayName;
        }
        // Reset pagination
        this.currentPage = 1;
        // Update state and fetch data
        this.currentApp = selectedApp;
        this.fetchHistoryData();
    },
    
    // Handle search
    handleSearch: function() {
        const newSearchQuery = this.elements.historySearchInput.value.trim();
        
        // Only fetch if search query changed
        if (newSearchQuery !== this.searchQuery) {
            this.searchQuery = newSearchQuery;
            this.currentPage = 1; // Reset to first page
            this.fetchHistoryData();
        }
    },
    
    // Handle page size change
    handlePageSizeChange: function() {
        const newPageSize = parseInt(this.elements.historyPageSize.value);
        if (newPageSize !== this.pageSize) {
            this.pageSize = newPageSize;
            this.currentPage = 1; // Reset to first page
            this.fetchHistoryData();
        }
    },
    
    // Handle pagination
    handlePagination: function(direction) {
        if (direction === 'prev' && this.currentPage > 1) {
            this.currentPage--;
            this.fetchHistoryData();
        } else if (direction === 'next' && this.currentPage < this.totalPages) {
            this.currentPage++;
            this.fetchHistoryData();
        }
    },
    
    // Handle clear history
    handleClearHistory: function() {
        if (confirm(`Are you sure you want to clear ${this.currentApp === 'all' ? 'all history' : this.currentApp + ' history'}?`)) {
            this.clearHistory();
        }
    },
    
    // Fetch history data from API
    fetchHistoryData: function() {
        this.setLoading(true);
        
        // Construct URL with parameters
        let url = `/api/history/${this.currentApp}?page=${this.currentPage}&page_size=${this.pageSize}`;
        if (this.searchQuery) {
            url += `&search=${encodeURIComponent(this.searchQuery)}`;
        }
        
        HuntarrUtils.fetchWithTimeout(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                this.totalPages = data.total_pages;
                this.renderHistoryData(data);
                this.updatePaginationUI();
                this.setLoading(false);
            })
            .catch(error => {
                console.error('Error fetching history data:', error);
                this.showError('Failed to load history data. Please try again later.');
                this.setLoading(false);
            });
    },
    
    // Clear history
    clearHistory: function() {
        this.setLoading(true);
        
        HuntarrUtils.fetchWithTimeout(`./api/history/${this.currentApp}`, {
            method: 'DELETE',
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(() => {
                // Reload data
                this.fetchHistoryData();
            })
            .catch(error => {
                console.error('Error clearing history:', error);
                this.showError('Failed to clear history. Please try again later.');
                this.setLoading(false);
            });
    },
    
    // Render history data to table
    renderHistoryData: function(data) {
        const tableBody = this.elements.historyTableBody;
        tableBody.innerHTML = '';
        
        if (!data.entries || data.entries.length === 0) {
            this.showEmptyState();
            return;
        }
        
        // Hide empty state
        this.elements.historyEmptyState.style.display = 'none';
        this.elements.historyTable.style.display = 'table';
        
        // Process entries and create rows
        this.renderHistoryEntries(data.entries);
    },
    
    // Render individual history entries (async to handle link creation)
    renderHistoryEntries: async function(entries) {
        const tableBody = this.elements.historyTableBody;
        
        // Process entries in batches to avoid overwhelming the UI
        const batchSize = 10;
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            
            // Process this batch
            const batchPromises = batch.map(entry => this.createHistoryRow(entry));
            const batchRows = await Promise.all(batchPromises);
            
            // Add rows to table
            batchRows.forEach(row => {
                if (row) tableBody.appendChild(row);
            });
            
            // Small delay between batches to keep UI responsive
            if (i + batchSize < entries.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    },
    
    // Create a single history row
    createHistoryRow: async function(entry) {
        const row = document.createElement('tr');
        
        // Format the instance name to include app type (capitalize first letter of app type)
        const appType = entry.app_type ? entry.app_type.charAt(0).toUpperCase() + entry.app_type.slice(1) : '';
        const formattedInstance = appType ? `${appType} - ${entry.instance_name}` : entry.instance_name;
        
        // Build the row content piece by piece to ensure ID has no wrapping elements
        const processedInfoCell = document.createElement('td');
        
        // Create info icon with hover tooltip functionality
        const infoIcon = document.createElement('i');
        infoIcon.className = 'fas fa-info-circle info-hover-icon';
        // Ensure the icon has the right content and is centered
        infoIcon.style.textAlign = 'center';
        
        // Create clickable title (async)
        const titleSpan = await this.createClickableLink(entry);
        
        // Create tooltip element for JSON data
        const tooltip = document.createElement('div');
        tooltip.className = 'json-tooltip';
        tooltip.style.display = 'none';
        
        // Format the JSON data for display
        let jsonData = {};
        try {
            // Extract available fields from the entry for the tooltip
            jsonData = {
                title: entry.processed_info,
                id: entry.id,
                app: entry.app_type || 'Unknown',
                instance: entry.instance_name || 'Default',
                date: entry.date_time_readable,
                operation: entry.operation_type,
                // Add any additional fields that might be useful
                details: entry.details || {}
            };
        } catch (e) {
            jsonData = { error: 'Could not parse JSON data', title: entry.processed_info };
        }
        
        // Create formatted JSON content
        const pre = document.createElement('pre');
        pre.className = 'json-content';
        pre.textContent = JSON.stringify(jsonData, null, 2);
        tooltip.appendChild(pre);
        
        // Add the tooltip to the document body for fixed positioning
        document.body.appendChild(tooltip);
        
        // Add hover events with proper positioning
        infoIcon.addEventListener('mouseenter', (e) => {
            const iconRect = infoIcon.getBoundingClientRect();
            
            // Position tooltip near the icon using fixed positioning
            tooltip.style.left = (iconRect.right + 10) + 'px';
            tooltip.style.top = iconRect.top + 'px';
            
            // Adjust if tooltip would go off screen
            const tooltipWidth = 350;
            if (iconRect.right + tooltipWidth + 10 > window.innerWidth) {
                tooltip.style.left = (iconRect.left - tooltipWidth - 10) + 'px';
            }
            
            // Adjust if tooltip would go off bottom of screen
            const tooltipHeight = 300; // max-height from CSS
            if (iconRect.top + tooltipHeight > window.innerHeight) {
                tooltip.style.top = (window.innerHeight - tooltipHeight - 10) + 'px';
            }
            
            tooltip.style.display = 'block';
        });
        
        // Add mouse leave event to hide tooltip
        infoIcon.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
        
        // Also hide tooltip when mouse enters the tooltip itself and then leaves
        tooltip.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
        
        // Create a container div to hold both icon and title on the same line
        const lineContainer = document.createElement('div');
        lineContainer.className = 'title-line-container';
        // Additional inline styles to ensure proper alignment
        lineContainer.style.display = 'flex';
        lineContainer.style.alignItems = 'flex-start';
        
        // Append icon and title to the container
        lineContainer.appendChild(infoIcon);
        lineContainer.appendChild(document.createTextNode(' ')); // Add space
        lineContainer.appendChild(titleSpan);
        
        // Add the container to the cell
        processedInfoCell.appendChild(lineContainer);
        
        const operationTypeCell = document.createElement('td');
        operationTypeCell.innerHTML = this.formatOperationType(entry.operation_type);
        
        // Create a plain text ID cell with no styling
        const idCell = document.createElement('td');
        idCell.className = 'plain-id';
        idCell.textContent = entry.id; // Use textContent to ensure no HTML parsing
        
        const instanceCell = document.createElement('td');
        instanceCell.innerHTML = this.escapeHtml(formattedInstance);
        
        const timeAgoCell = document.createElement('td');
        timeAgoCell.innerHTML = this.escapeHtml(entry.how_long_ago);
        
        // Clear any existing content and append the cells
        row.innerHTML = '';
        row.appendChild(processedInfoCell);
        row.appendChild(operationTypeCell);
        row.appendChild(idCell);
        row.appendChild(instanceCell);
        row.appendChild(timeAgoCell);
        
        return row;
    },
    
    // Update pagination UI
    updatePaginationUI: function() {
        this.elements.historyCurrentPage.textContent = this.currentPage;
        this.elements.historyTotalPages.textContent = this.totalPages;
        
        // Enable/disable pagination buttons
        this.elements.historyPrevPage.disabled = this.currentPage <= 1;
        this.elements.historyNextPage.disabled = this.currentPage >= this.totalPages;
    },
    
    // Show empty state
    showEmptyState: function() {
        this.elements.historyTable.style.display = 'none';
        this.elements.historyEmptyState.style.display = 'flex';
    },
    
    // Show error
    showError: function(message) {
        // Use huntarrUI's notification system if available
        if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
            huntarrUI.showNotification(message, 'error');
        } else {
            alert(message);
        }
    },
    
    // Set loading state
    setLoading: function(isLoading) {
        this.isLoading = isLoading;
        
        if (isLoading) {
            this.elements.historyLoading.style.display = 'flex';
            this.elements.historyTable.style.display = 'none';
            this.elements.historyEmptyState.style.display = 'none';
        } else {
            this.elements.historyLoading.style.display = 'none';
        }
    },
    
    // Helper function to escape HTML
    escapeHtml: function(text) {
        if (text === null || text === undefined) return '';
        
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        
        return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
    },
    
    // Helper function to format operation type with gradient styling
    formatOperationType: function(operationType) {
        switch (operationType) {
            case 'missing':
                return '<span class="operation-status missing">Missing</span>';
            case 'upgrade':
                return '<span class="operation-status upgrade">Upgrade</span>';
            case 'warning':
                return '<span class="operation-status warning">Warning</span>';
            case 'error':
                return '<span class="operation-status error">Error</span>';
            case 'success':
                return '<span class="operation-status success">Success</span>';
            default:
                return operationType ? this.escapeHtml(operationType.charAt(0).toUpperCase() + operationType.slice(1)) : 'Unknown';
        }
    },
    
    // Get instance settings for a specific app and instance name
    getInstanceSettings: async function(appType, instanceName) {
        const cacheKey = `${appType}-${instanceName}`;
        
        // Return cached result if available
        if (this.instanceSettingsCache[cacheKey]) {
            return this.instanceSettingsCache[cacheKey];
        }
        
        try {
            const response = await HuntarrUtils.fetchWithTimeout(`./api/settings/${appType}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${appType} settings`);
            }
            
            const settings = await response.json();
            
            // Find the matching instance by name
            if (settings.instances && Array.isArray(settings.instances)) {
                const instance = settings.instances.find(inst => inst.name === instanceName);
                if (instance && instance.api_url) {
                    // Cache the result
                    this.instanceSettingsCache[cacheKey] = instance;
                    return instance;
                }
            }
            
            // Cache null result to avoid repeated failed attempts
            this.instanceSettingsCache[cacheKey] = null;
            return null;
        } catch (error) {
            console.error(`Error fetching instance settings for ${appType}-${instanceName}:`, error);
            // Cache null result
            this.instanceSettingsCache[cacheKey] = null;
            return null;
        }
    },
    
    // Generate direct link to item in *arr application
    generateDirectLink: function(appType, instanceUrl, itemId, title) {
        if (!instanceUrl) return null;
        
        // Ensure URL doesn't end with slash and remove any localhost prefix
        let baseUrl = instanceUrl.replace(/\/$/, '');
        
        // Remove localhost:9705 prefix if present (this happens when the instance URL gets prepended)
        baseUrl = baseUrl.replace(/^.*localhost:\d+\//, '');
        
        // Ensure we have http:// or https:// prefix
        if (!baseUrl.match(/^https?:\/\//)) {
            baseUrl = 'http://' + baseUrl;
        }
        
        // Generate appropriate path based on app type
        let path;
        switch (appType.toLowerCase()) {
            case 'sonarr':
                // Sonarr uses title-based slugs, not IDs
                if (title) {
                    // Extract series title from the full title (remove season info, episode info, etc.)
                    let seriesTitle = title;
                    
                    // Remove season and episode information
                    seriesTitle = seriesTitle.replace(/\s*-\s*S\d+.*$/i, ''); // Remove "- S13 - COMPLETE SEASON PACK"
                    seriesTitle = seriesTitle.replace(/\s*-\s*Season\s+\d+.*$/i, ''); // Remove "- Season 13..."
                    seriesTitle = seriesTitle.replace(/\s*-\s*\w\d+\w\d+.*$/i, ''); // Remove "- S01E01..."
                    
                    // Handle country codes in parentheses - convert (US) to -us, etc.
                    seriesTitle = seriesTitle.replace(/\s*\(([A-Z]{2,3})\)$/i, '-$1'); // Convert (US) to -US
                    
                    // Remove other parenthetical info like years
                    seriesTitle = seriesTitle.replace(/\s*\(\d{4}\).*$/, ''); // Remove (2023) and anything after
                    seriesTitle = seriesTitle.replace(/\s*\([^)]*\)$/, ''); // Remove other parenthetical info
                    
                    // Convert to slug format (lowercase, replace spaces and special chars with dashes)
                    const slug = seriesTitle
                        .toLowerCase()
                        .trim()
                        .replace(/[^\w\s-]/g, '') // Remove special characters except dashes and spaces
                        .replace(/\s+/g, '-') // Replace spaces with dashes
                        .replace(/-+/g, '-') // Replace multiple dashes with single dash
                        .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
                    
                    path = `/series/${slug}`;
                } else {
                    // Fallback to ID if no title available
                    path = `/series/${itemId}`;
                }
                break;
            case 'radarr':
                // Radarr also uses title-based slugs
                if (title) {
                    // Extract movie title (remove year and other info)
                    let movieTitle = title.replace(/\s*\(\d{4}\).*$/, ''); // Remove (2023) and anything after
                    
                    const slug = movieTitle
                        .toLowerCase()
                        .trim()
                        .replace(/[^\w\s-]/g, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-')
                        .replace(/^-|-$/g, '');
                    
                    path = `/movie/${slug}`;
                } else {
                    path = `/movie/${itemId}`;
                }
                break;
            case 'lidarr':
                path = `/artist/${itemId}`;
                break;
            case 'readarr':
                path = `/author/${itemId}`;
                break;
            case 'whisparr':
            case 'eros':
                path = `/series/${itemId}`;
                break;
            default:
                console.warn(`Unknown app type for direct link: ${appType}`);
                return null;
        }
        
        return `${baseUrl}${path}`;
    },
    
    // Create clickable link element
    createClickableLink: async function(entry) {
        const titleSpan = document.createElement('span');
        titleSpan.className = 'processed-title';
        titleSpan.style.wordBreak = 'break-word';
        titleSpan.style.whiteSpace = 'normal';
        titleSpan.style.overflow = 'visible';
        
        // Only create links for Sonarr entries
        if (entry.app_type && entry.app_type.toLowerCase() === 'sonarr') {
            // Try to get instance settings and create link
            try {
                const instanceSettings = await this.getInstanceSettings(entry.app_type, entry.instance_name);
                
                if (instanceSettings && instanceSettings.api_url) {
                    const directLink = this.generateDirectLink(entry.app_type, instanceSettings.api_url, entry.id, entry.processed_info);
                    
                    if (directLink) {
                        // Create clickable link
                        const linkElement = document.createElement('a');
                        linkElement.href = directLink;
                        linkElement.target = '_blank';
                        linkElement.rel = 'noopener noreferrer';
                        linkElement.className = 'history-direct-link';
                        linkElement.textContent = entry.processed_info;
                        linkElement.title = `Open in ${entry.app_type.charAt(0).toUpperCase() + entry.app_type.slice(1)}`;
                        
                        titleSpan.appendChild(linkElement);
                        return titleSpan;
                    }
                }
            } catch (error) {
                console.warn(`Could not create direct link for ${entry.app_type}-${entry.instance_name}:`, error);
            }
        }
        
        // Fallback to plain text for all non-Sonarr apps or if link creation fails
        titleSpan.textContent = entry.processed_info;
        return titleSpan;
    }
};

// Initialize when huntarrUI is ready
document.addEventListener('DOMContentLoaded', () => {
    historyModule.init();
    
    // Connect with main app
    if (typeof huntarrUI !== 'undefined') {
        // Add loadHistory to the section switch handler
        const originalSwitchSection = huntarrUI.switchSection;
        
        huntarrUI.switchSection = function(section) {
            // Call original function
            originalSwitchSection.call(huntarrUI, section);
            
            // Load history data when switching to history section
            if (section === 'history') {
                historyModule.loadHistory();
            }
        };
    }
});
