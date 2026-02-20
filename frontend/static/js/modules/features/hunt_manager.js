/**
 * Huntarr - Hunt Manager Module
 * Handles displaying and managing hunt history entries for all media apps
 */

const huntManagerModule = {
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
    
    // Initialize the hunt manager module
    init: function() {
        this.cacheElements();
        
        // Ensure UI matches state
        if (this.elements.pageSize) {
            this.elements.pageSize.value = this.pageSize;
        }
        
        this.setupEventListeners();
        
        // Initial load if hunt manager is active section
        if (huntarrUI && huntarrUI.currentSection === 'hunt-manager') {
            this.loadHuntHistory();
        }
    },
    
    // Cache DOM elements
    cacheElements: function() {
        this.elements = {
            section: document.getElementById('huntManagerSection'),
            appSelect: document.getElementById('huntManagerAppSelect'),
            searchInput: document.getElementById('huntManagerSearchInput'),
            searchButton: document.getElementById('huntManagerSearchButton'),
            pageSize: document.getElementById('huntManagerPageSize'),
            clearButton: document.getElementById('clearHuntManagerButton'),
            prevButton: document.getElementById('huntManagerPrevPage'),
            nextButton: document.getElementById('huntManagerNextPage'),
            currentPage: document.getElementById('huntManagerCurrentPage'),
            totalPages: document.getElementById('huntManagerTotalPages'),
            pageInfo: document.getElementById('huntManagerPageInfo'),
            tableBody: document.getElementById('huntManagerTableBody'),
            emptyState: document.getElementById('huntManagerEmptyState'),
            loading: document.getElementById('huntManagerLoading'),
            connectionStatus: document.getElementById('huntManagerConnectionStatus')
        };
    },
    
    // Update connection status indicator
    updateConnectionStatus: function(state, text) {
        if (!this.elements.connectionStatus) return;
        this.elements.connectionStatus.textContent = text || state;
        this.elements.connectionStatus.className = 'hm-status-' + state;
    },
    
    // Setup event listeners
    setupEventListeners: function() {
        if (!this.elements.appSelect) return;
        
        // App filter
        this.elements.appSelect.addEventListener('change', (e) => {
            this.currentApp = e.target.value;
            this.currentPage = 1;
            this.loadHuntHistory();
        });
        
        // Search functionality
        this.elements.searchButton.addEventListener('click', () => this.performSearch());
        this.elements.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch();
            }
        });
        
        // Page size change
        this.elements.pageSize.addEventListener('change', (e) => {
            this.pageSize = parseInt(e.target.value);
            this.currentPage = 1;
            this.loadHuntHistory();
        });
        
        // Clear button
        this.elements.clearButton.addEventListener('click', () => this.clearHuntHistory());
        
        // Pagination
        this.elements.prevButton.addEventListener('click', () => this.previousPage());
        this.elements.nextButton.addEventListener('click', () => this.nextPage());
        
        // Hunt item links - delegated event listener
        document.addEventListener('click', (e) => {
            if (e.target.matches('.hunt-item-link') || e.target.closest('.hunt-item-link')) {
                const link = e.target.matches('.hunt-item-link') ? e.target : e.target.closest('.hunt-item-link');
                const appType = link.dataset.app;
                const instanceName = link.dataset.instance;
                const itemId = link.dataset.itemId;
                const title = link.textContent; // Use the text content as the title
                
                console.log('Hunt item clicked:', { appType, instanceName, itemId, title });
 
                // Process clicks for Sonarr, Radarr, Lidarr (open in *arr), or Movie Hunt (navigate to Movie Hunt)
                if ((appType === 'sonarr' || appType === 'radarr' || appType === 'lidarr') && instanceName) {
                    huntManagerModule.openAppInstance(appType, instanceName, itemId, title);
                } else if ((appType === 'sonarr' || appType === 'radarr' || appType === 'lidarr') && window.huntarrUI) {
                    window.huntarrUI.switchSection('apps');
                    window.location.hash = '#apps';
                    console.log(`Navigated to apps section for ${appType}`);
                } else if (appType === 'movie_hunt' && window.huntarrUI) {
                    window.huntarrUI.switchSection('movie-hunt-home');
                    window.location.hash = '#movie-hunt-home';
                    console.log('Navigated to Movie Hunt');
                } else if (appType === 'tv_hunt' && window.huntarrUI) {
                    window.huntarrUI.switchSection('tv-hunt-collection');
                    window.location.hash = '#tv-hunt-collection';
                    console.log('Navigated to TV Hunt');
                } else {
                    console.log(`Clicking disabled for ${appType}`);
                }
            }
        });
    },
    
    // Perform search
    performSearch: function() {
        this.searchQuery = this.elements.searchInput.value.trim();
        this.currentPage = 1;
        this.loadHuntHistory();
    },
    
    // Clear hunt history
    clearHuntHistory: function() {
        const appDisplayNames = { movie_hunt: 'Movie Hunt', tv_hunt: 'TV Hunt', sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr', readarr: 'Readarr', whisparr: 'Whisparr V2', eros: 'Whisparr V3' };
        const appName = this.currentApp === 'all' ? 'all apps' : (appDisplayNames[this.currentApp] || this.currentApp);
        const msg = `Are you sure you want to clear hunt history for ${appName}? This action cannot be undone.`;
        const self = this;
        const doClear = function() {
            HuntarrUtils.fetchWithTimeout(`./api/hunt-manager/${self.currentApp}`, {
            method: 'DELETE'
        })
        .then(response => response.json().then(data => ({ response, data })))
        .then(({ response, data }) => {
            if (response.ok) {
                console.log(`Cleared hunt history for ${self.currentApp}`);
                self.loadHuntHistory();
                if (huntarrUI && huntarrUI.showNotification) {
                    huntarrUI.showNotification(`Hunt history cleared for ${appName}`, 'success');
                }
            } else {
                throw new Error(data.error || 'Failed to clear hunt history');
            }
        })
        .catch(error => {
            console.error(`Error clearing hunt history:`, error);
            if (huntarrUI && huntarrUI.showNotification) {
                huntarrUI.showNotification(`Error clearing hunt history: ${error.message}`, 'error');
            }
        });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Clear Hunt History', message: msg, confirmLabel: 'Clear', onConfirm: doClear });
        } else {
            if (!confirm(msg)) return;
            doClear();
        }
    },
    
    // Load hunt history
    loadHuntHistory: function() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading(true);
        this.updateConnectionStatus('loading', 'Loading...');
        
        const params = new URLSearchParams({
            page: this.currentPage,
            page_size: this.pageSize
        });
        
        if (this.searchQuery) {
            params.append('search', this.searchQuery);
        }
        
        HuntarrUtils.fetchWithTimeout(`./api/hunt-manager/${this.currentApp}?${params.toString()}`)
            .then(response => response.json())
            .then(data => {
                if (data.entries !== undefined) {
                    this.displayHuntHistory(data);
                    this.updateConnectionStatus('connected', 'Connected');
                } else {
                    throw new Error(data.error || 'Invalid response format');
                }
            })
            .catch(error => {
                console.error('Error loading hunt history:', error);
                this.showError(`Error loading hunt history: ${error.message}`);
                this.updateConnectionStatus('error', 'Connection error');
            })
            .finally(() => {
                this.isLoading = false;
                this.showLoading(false);
            });
    },
    
    // Display hunt history
    displayHuntHistory: function(data) {
        this.totalPages = data.total_pages || 1;
        this.currentPage = data.current_page || 1;
        
        // Update pagination info
        this.elements.currentPage.textContent = this.currentPage;
        this.elements.totalPages.textContent = this.totalPages;
        
        // Update pagination buttons
        this.elements.prevButton.disabled = this.currentPage <= 1;
        this.elements.nextButton.disabled = this.currentPage >= this.totalPages;
        
        // Clear table body
        this.elements.tableBody.innerHTML = '';
        
        if (data.entries.length === 0) {
            this.showEmptyState(true);
            return;
        }
        
        this.showEmptyState(false);
        
        // Populate table
        data.entries.forEach(entry => {
            const row = this.createHuntHistoryRow(entry);
            this.elements.tableBody.appendChild(row);
        });
    },
    
    // Create hunt history table row
    createHuntHistoryRow: function(entry) {
        const row = document.createElement('tr');
        
        // Processed info with link (if available)
        const processedInfoCell = document.createElement('td');
        processedInfoCell.className = 'col-info';
        processedInfoCell.innerHTML = this.formatProcessedInfo(entry);
        
        // Operation type
        const operationCell = document.createElement('td');
        operationCell.className = 'col-op';
        operationCell.innerHTML = this.formatOperation(entry.operation_type);
        
        // Media ID
        const idCell = document.createElement('td');
        idCell.className = 'col-id';
        idCell.textContent = entry.media_id;
        
        // App instance (formatted as "App Name (Instance Name)")
        const instanceCell = document.createElement('td');
        instanceCell.className = 'col-instance';
        const appDisplayNames = { whisparr: 'Whisparr V2', eros: 'Whisparr V3', movie_hunt: 'Movie Hunt', tv_hunt: 'TV Hunt' };
        const appName = appDisplayNames[entry.app_type] || (entry.app_type.charAt(0).toUpperCase() + entry.app_type.slice(1).replace(/_/g, ' '));
        instanceCell.textContent = `${appName} (${entry.instance_name || 'Default'})`;
        
        // How long ago
        const timeCell = document.createElement('td');
        timeCell.className = 'col-time';
        timeCell.textContent = entry.how_long_ago;
        
        row.appendChild(processedInfoCell);
        row.appendChild(operationCell);
        row.appendChild(idCell);
        row.appendChild(instanceCell);
        row.appendChild(timeCell);
        
        return row;
    },
    
    // Format processed info
    formatProcessedInfo: function(entry) {
        // Sonarr, Radarr, Lidarr: clickable to open in *arr app; Movie Hunt / TV Hunt: clickable to go to section
        const isArrClickable = (entry.app_type === 'sonarr' || entry.app_type === 'radarr' || entry.app_type === 'lidarr') && entry.instance_name;
        const isMovieHuntClickable = entry.app_type === 'movie_hunt';
        const isTVHuntClickable = entry.app_type === 'tv_hunt';
        const isClickable = isArrClickable || isMovieHuntClickable || isTVHuntClickable;
        const escapeAttr = (s) => { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
        const dataAttributes = isClickable ?
            `data-app="${escapeAttr(entry.app_type)}" data-instance="${escapeAttr(entry.instance_name || '')}" data-item-id="${escapeAttr(entry.media_id || '')}"` :
            `data-app="${escapeAttr(entry.app_type)}"`;
        let title = `${entry.app_type} (${entry.instance_name || 'Default'})`;
        if (isArrClickable) title = `Click to open in ${entry.app_type} (${entry.instance_name})`;
        else if (isMovieHuntClickable) title = 'Click to open Movie Hunt';
        else if (isTVHuntClickable) title = 'Click to open TV Hunt';

        const linkClass = isClickable ? 'hunt-item-link' : '';
        const titleAttr = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let html = `<div class="hunt-info-wrapper">
            <span class="${linkClass}" ${dataAttributes} title="${titleAttr}">${this.escapeHtml(entry.processed_info)}</span>`;
        
        if (entry.discovered) {
            html += ' <span class="discovery-badge"><i class="fas fa-search"></i> Discovered</span>';
        }
        
        html += '</div>';
        
        return html;
    },
    
    // Format operation type
    formatOperation: function(operationType) {
        const operationMap = {
            'missing': { text: 'Missing', class: 'operation-missing' },
            'upgrade': { text: 'Upgrade', class: 'operation-upgrade' },
            'import': { text: 'Import', class: 'operation-upgrade' }
        };
        
        const operation = operationMap[(operationType || '').toLowerCase()] || { text: (operationType || 'Unknown'), class: 'operation-unknown' };
        return `<span class="operation-badge ${operation.class}">${operation.text}</span>`;
    },
    
    // Utility to escape HTML
    escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    // Show/hide loading state
    showLoading: function(show) {
        if (this.elements.loading) {
            this.elements.loading.style.display = show ? 'block' : 'none';
        }
    },
    
    // Show/hide empty state
    showEmptyState: function(show) {
        if (this.elements.emptyState) {
            this.elements.emptyState.style.display = show ? 'block' : 'none';
        }
    },
    
    // Show error message
    showError: function(message) {
        console.error('Hunt Manager Error:', message);
        if (huntarrUI && huntarrUI.showNotification) {
            huntarrUI.showNotification(message, 'error');
        }
    },
    
    // Navigation methods
    previousPage: function() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.loadHuntHistory();
        }
    },
    
    nextPage: function() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.loadHuntHistory();
        }
    },
    
    // Refresh hunt history (called when section becomes active)
    refresh: function() {
        this.loadHuntHistory();
    },
    
    // Generate direct link to item in *arr application (7.7.5 logic)
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
                // Sonarr uses title-based slugs in format: /series/show-name-year
                if (title) {
                    // Extract series title with year from hunt manager format
                    // Example: "The Twilight Zone (1985) - Season 1 (contains 2 missing episodes)"
                    // We want: "The Twilight Zone (1985)"
                    let seriesTitle = title;
                    
                    // Remove everything after " - " (season/episode info)
                    if (seriesTitle.includes(' - ')) {
                        seriesTitle = seriesTitle.split(' - ')[0];
                    }
                    
                    // Generate Sonarr-compatible slug
                    const slug = seriesTitle
                        .toLowerCase()
                        .trim()
                        // Replace parentheses with hyphens: "(1985)" becomes "-1985"
                        .replace(/\s*\((\d{4})\)\s*/g, '-$1')
                        // Remove other special characters except hyphens and spaces
                        .replace(/[^\w\s-]/g, '')
                        // Replace multiple spaces with single space
                        .replace(/\s+/g, ' ')
                        // Replace spaces with hyphens
                        .replace(/\s/g, '-')
                        // Remove multiple consecutive hyphens
                        .replace(/-+/g, '-')
                        // Remove leading/trailing hyphens
                        .replace(/^-|-$/g, '');
                    
                    console.log('Sonarr slug generation:', {
                        originalTitle: title,
                        extractedSeriesTitle: seriesTitle,
                        generatedSlug: slug
                    });
                    
                    path = `/series/${slug}`;
                } else {
                    path = `/series/${itemId}`;
                }
                break;
            case 'radarr':
                // Radarr uses numeric IDs
                path = `/movie/${itemId}`;
                break;
            case 'lidarr':
                // Lidarr uses foreignAlbumId (MusicBrainz UUID)
                path = `/album/${itemId}`;
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

    // Get instance settings for an app
    getInstanceSettings: async function(appType, instanceName) {
        try {
            const response = await fetch(`./api/settings/${appType}`, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const settingsData = await response.json();
            console.log('Raw settings data:', settingsData);
            
            // Check if this is a settings object with instances array
            if (settingsData && settingsData.instances && Array.isArray(settingsData.instances)) {
                // Match by display name (inst.name) OR instance_id (for entries stored with instance_id)
                const instance = settingsData.instances.find(inst => 
                    inst.name === instanceName || inst.instance_id === instanceName
                );
                
                if (instance) {
                    console.log('Found instance:', instance);
                    return {
                        api_url: instance.api_url || instance.url,
                        external_url: instance.external_url || ''
                    };
                }
            }
            // Fallback for legacy single-instance settings
            else if (settingsData && settingsData.api_url && instanceName === 'Default') {
                console.log('Using legacy single-instance settings');
                return {
                    api_url: settingsData.api_url,
                    external_url: settingsData.external_url || ''
                };
            }
            
            console.warn(`Instance "${instanceName}" not found in settings`);
            return null;
        } catch (error) {
            console.error(`Error fetching ${appType} settings:`, error);
            return null;
        }
    },
    
    // Open external app instance with direct linking (7.7.5 logic)
    openAppInstance: function(appType, instanceName, itemId = null, title = null) {
        console.log(`Opening ${appType} instance: ${instanceName} with itemId: ${itemId}, title: ${title}`);
        
        this.getInstanceSettings(appType, instanceName)
            .then(instanceSettings => {
                console.log('Instance settings retrieved:', instanceSettings);
                
                if (instanceSettings && instanceSettings.api_url) {
                    let targetUrl;
                    
                    // Prefer external_url for browser links (issue #617)
                    const browserUrl = instanceSettings.external_url || instanceSettings.api_url;
 
                    // If we have item details, try to create a direct link for supported apps
                    if (itemId && ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'].includes(appType.toLowerCase())) {
                        targetUrl = this.generateDirectLink(appType, browserUrl, itemId, title);
                        console.log('Generated direct link:', targetUrl);
                    }
                    
                    // Fallback to base URL if direct link creation fails
                    if (!targetUrl) {
                        let baseUrl = browserUrl.replace(/\/$/, '');
                        baseUrl = baseUrl.replace(/^.*localhost:\d+\//, '');
                        
                        if (!baseUrl.match(/^https?:\/\//)) {
                            baseUrl = 'http://' + baseUrl;
                        }
                        
                        targetUrl = baseUrl;
                        console.log('Using fallback base URL:', targetUrl);
                    }
                    
                    // Open the external instance in a new tab
                    console.log(`About to open: ${targetUrl}`);
                    window.open(targetUrl, '_blank');
                    console.log(`Opened ${appType} instance ${instanceName} at ${targetUrl}`);
                } else {
                    console.warn(`Could not find URL for ${appType} instance: ${instanceName}`);
                    console.warn('Instance settings:', instanceSettings);
                    // Fallback to Apps section
                    if (window.huntarrUI) {
                        window.huntarrUI.switchSection('apps');
                        window.location.hash = '#apps';
                    }
                }
            })
            .catch(error => {
                console.error(`Error fetching ${appType} settings:`, error);
                // Fallback to Apps section
                if (window.huntarrUI) {
                    window.huntarrUI.switchSection('apps');
                    window.location.hash = '#apps';
                }
            });
    },

    // Open Sonarr instance (legacy wrapper)
    openSonarrInstance: function(instanceName) {
        this.openAppInstance('sonarr', instanceName);
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    huntManagerModule.init();
});

// Make module available globally
window.huntManagerModule = huntManagerModule; 