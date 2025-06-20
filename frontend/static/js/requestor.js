/**
 * Requestor functionality - Media search and request system
 */

class RequestorModule {
    constructor() {
        this.searchTimeout = null;
        this.instances = { sonarr: [], radarr: [] };
        this.init();
    }

    init() {
        this.loadInstances();
        this.setupEventListeners();
        this.loadSettings();
    }

    setupEventListeners() {
        // Search input with debouncing
        const searchInput = document.getElementById('requestor-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchTimeout);
                const query = e.target.value.trim();
                
                if (query.length >= 2) {
                    this.searchTimeout = setTimeout(() => {
                        this.searchMedia(query);
                    }, 500); // 500ms debounce
                } else {
                    this.clearResults();
                }
            });
        }

        // Settings form
        const settingsForm = document.getElementById('requestor-settings-form');
        if (settingsForm) {
            settingsForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveSettings();
            });
        }
    }

    async loadSettings() {
        try {
            const response = await fetch('./api/requestor/settings');
            const settings = await response.json();
            
            const apiKeyInput = document.getElementById('requestor-tmdb-api-key');
            const enabledToggle = document.getElementById('requestor-enabled');
            
            if (apiKeyInput) apiKeyInput.value = settings.tmdb_api_key || '';
            if (enabledToggle) enabledToggle.checked = settings.enabled || false;
            
        } catch (error) {
            console.error('Error loading requestor settings:', error);
        }
    }

    async saveSettings() {
        try {
            const apiKey = document.getElementById('requestor-tmdb-api-key').value;
            const enabled = document.getElementById('requestor-enabled').checked;
            
            const response = await fetch('./api/requestor/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tmdb_api_key: apiKey,
                    enabled: enabled
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('Settings saved successfully', 'success');
            } else {
                this.showNotification('Failed to save settings', 'error');
            }
            
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showNotification('Error saving settings', 'error');
        }
    }

    async loadInstances() {
        try {
            const response = await fetch('./api/requestor/instances');
            this.instances = await response.json();
            this.updateInstanceDropdowns();
        } catch (error) {
            console.error('Error loading instances:', error);
        }
    }

    updateInstanceDropdowns() {
        const dropdowns = document.querySelectorAll('.instance-dropdown');
        dropdowns.forEach(dropdown => {
            dropdown.innerHTML = '<option value="">Select instance...</option>';
            
            // Add Sonarr instances
            this.instances.sonarr.forEach(instance => {
                const option = document.createElement('option');
                option.value = `sonarr:${instance.name}`;
                option.textContent = `Sonarr - ${instance.name}`;
                dropdown.appendChild(option);
            });
            
            // Add Radarr instances
            this.instances.radarr.forEach(instance => {
                const option = document.createElement('option');
                option.value = `radarr:${instance.name}`;
                option.textContent = `Radarr - ${instance.name}`;
                dropdown.appendChild(option);
            });
        });
    }

    async searchMedia(query) {
        const resultsContainer = document.getElementById('requestor-results');
        if (!resultsContainer) return;

        // Show loading
        resultsContainer.innerHTML = '<div class="loading">Searching...</div>';

        try {
            const response = await fetch(`./api/requestor/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            
            this.displayResults(data.results || []);
            
        } catch (error) {
            console.error('Error searching media:', error);
            resultsContainer.innerHTML = '<div class="error">Search failed. Please try again.</div>';
        }
    }

    displayResults(results) {
        const resultsContainer = document.getElementById('requestor-results');
        if (!resultsContainer) return;

        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results">No results found.</div>';
            return;
        }

        const resultsHTML = results.map(item => this.createResultCard(item)).join('');
        resultsContainer.innerHTML = resultsHTML;

        // Add event listeners to request buttons
        this.setupRequestButtons();
    }

    createResultCard(item) {
        const year = item.year ? `(${item.year})` : '';
        const poster = item.poster_path || './static/images/no-poster.png';
        const mediaTypeIcon = item.media_type === 'movie' ? '🎬' : '📺';
        const rating = item.vote_average ? `⭐ ${item.vote_average.toFixed(1)}` : '';
        
        return `
            <div class="result-card" data-tmdb-id="${item.tmdb_id}" data-media-type="${item.media_type}">
                <div class="result-poster">
                    <img src="${poster}" alt="${item.title}" onerror="this.src='./static/images/no-poster.png'">
                    <div class="media-type-badge">${mediaTypeIcon}</div>
                </div>
                <div class="result-info">
                    <h3 class="result-title">${item.title} ${year}</h3>
                    <p class="result-overview">${item.overview.substring(0, 150)}${item.overview.length > 150 ? '...' : ''}</p>
                    <div class="result-meta">
                        <span class="rating">${rating}</span>
                        <span class="media-type">${item.media_type === 'movie' ? 'Movie' : 'TV Show'}</span>
                    </div>
                    <div class="request-section">
                        <select class="instance-dropdown" data-media-type="${item.media_type}">
                            <option value="">Select instance...</option>
                        </select>
                        <button class="request-btn" data-item='${JSON.stringify(item)}'>
                            Request
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    setupRequestButtons() {
        // Update instance dropdowns for new results
        this.updateInstanceDropdowns();
        
        // Filter dropdowns based on media type
        document.querySelectorAll('.instance-dropdown').forEach(dropdown => {
            const mediaType = dropdown.dataset.mediaType;
            const options = dropdown.querySelectorAll('option');
            
            options.forEach(option => {
                if (option.value === '') return; // Keep the default option
                
                const [appType] = option.value.split(':');
                const shouldShow = (mediaType === 'movie' && appType === 'radarr') || 
                                  (mediaType === 'tv' && appType === 'sonarr');
                
                option.style.display = shouldShow ? 'block' : 'none';
            });
        });

        // Add click handlers to request buttons
        document.querySelectorAll('.request-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                this.handleRequest(e.target);
            });
        });
    }

    async handleRequest(button) {
        const item = JSON.parse(button.dataset.item);
        const dropdown = button.parentElement.querySelector('.instance-dropdown');
        const selectedInstance = dropdown.value;

        if (!selectedInstance) {
            this.showNotification('Please select an instance', 'warning');
            return;
        }

        const [appType, instanceName] = selectedInstance.split(':');
        
        // Validate media type and app type compatibility
        if ((item.media_type === 'movie' && appType !== 'radarr') ||
            (item.media_type === 'tv' && appType !== 'sonarr')) {
            this.showNotification('Invalid app type for this media', 'error');
            return;
        }

        // Disable button and show loading
        button.disabled = true;
        button.textContent = 'Requesting...';

        try {
            const response = await fetch('./api/requestor/request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tmdb_id: item.tmdb_id,
                    media_type: item.media_type,
                    title: item.title,
                    year: item.year,
                    overview: item.overview,
                    poster_path: item.poster_path,
                    backdrop_path: item.backdrop_path,
                    app_type: appType,
                    instance_name: instanceName
                })
            });

            const result = await response.json();

            if (result.success) {
                button.textContent = 'Requested ✓';
                button.className = 'request-btn requested';
                this.showNotification(result.message, 'success');
            } else {
                button.textContent = 'Request';
                button.disabled = false;
                this.showNotification(result.message, 'error');
            }

        } catch (error) {
            console.error('Error requesting media:', error);
            button.textContent = 'Request';
            button.disabled = false;
            this.showNotification('Request failed', 'error');
        }
    }

    clearResults() {
        const resultsContainer = document.getElementById('requestor-results');
        if (resultsContainer) {
            resultsContainer.innerHTML = '';
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add to page
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('requestor-search') || document.getElementById('requestor-settings-form')) {
        window.requestorModule = new RequestorModule();
    }
}); 