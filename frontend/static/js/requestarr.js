/**
 * Requestarr functionality - Media search and request system
 */

class RequestarrModule {
    constructor() {
        this.searchTimeout = null;
        this.instances = { sonarr: [], radarr: [] };
        this.selectedInstance = null;
        this.init();
    }

    init() {
        this.loadInstances();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Instance selection
        const instanceSelect = document.getElementById('requestarr-instance-select');
        if (instanceSelect) {
            instanceSelect.addEventListener('change', (e) => this.handleInstanceChange(e));
        }

        // Search input with debouncing
        const searchInput = document.getElementById('requestarr-search');
        if (searchInput) {
            searchInput.disabled = true;
            searchInput.placeholder = 'Select an instance first...';
            
            searchInput.addEventListener('input', (e) => {
                if (!this.selectedInstance) {
                    this.showNotification('Please select an instance first', 'warning');
                    return;
                }
                
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
    }

    handleInstanceChange(event) {
        const selectedValue = event.target.value;
        if (selectedValue) {
            const [appType, instanceName] = selectedValue.split('|');
            this.selectedInstance = { appType, instanceName };
            
            // Clear previous results and enable search
            this.clearResults();
            const searchInput = document.getElementById('requestarr-search');
            if (searchInput) {
                searchInput.disabled = false;
                searchInput.placeholder = `Search for ${appType === 'radarr' ? 'movies' : 'TV shows'}...`;
                searchInput.value = '';
            }
        } else {
            this.selectedInstance = null;
            const searchInput = document.getElementById('requestarr-search');
            if (searchInput) {
                searchInput.disabled = true;
                searchInput.placeholder = 'Select an instance first...';
                searchInput.value = '';
            }
            this.clearResults();
        }
    }

    async loadInstances() {
        try {
            const response = await fetch('./api/requestarr/instances');
            this.instances = await response.json();
            this.updateInstanceSelect();
        } catch (error) {
            console.error('Error loading instances:', error);
            this.showNotification('Error loading instances', 'error');
        }
    }

    updateInstanceSelect() {
        const instanceSelect = document.getElementById('requestarr-instance-select');
        if (!instanceSelect) return;
        
        instanceSelect.innerHTML = '<option value="">Select an instance to search...</option>';
        
        // Add Sonarr instances
        this.instances.sonarr.forEach(instance => {
            const option = document.createElement('option');
            option.value = `sonarr|${instance.name}`;
            option.textContent = `Sonarr - ${instance.name}`;
            instanceSelect.appendChild(option);
        });
        
        // Add Radarr instances
        this.instances.radarr.forEach(instance => {
            const option = document.createElement('option');
            option.value = `radarr|${instance.name}`;
            option.textContent = `Radarr - ${instance.name}`;
            instanceSelect.appendChild(option);
        });
    }

    async searchMedia(query) {
        if (!this.selectedInstance) {
            this.showNotification('Please select an instance first', 'warning');
            return;
        }

        const resultsContainer = document.getElementById('requestarr-results');
        if (!resultsContainer) return;

        // Show loading
        resultsContainer.innerHTML = '<div class="loading">🔍 Searching and checking availability...</div>';

        try {
            const params = new URLSearchParams({
                q: query,
                app_type: this.selectedInstance.appType,
                instance_name: this.selectedInstance.instanceName
            });
            
            const response = await fetch(`./api/requestarr/search?${params}`);
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            this.displayResults(data.results || []);
            
        } catch (error) {
            console.error('Error searching media:', error);
            resultsContainer.innerHTML = '<div class="error">Search failed. Please try again.</div>';
        }
    }

    displayResults(results) {
        const resultsContainer = document.getElementById('requestarr-results');
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
        // Use a simple data URL placeholder instead of missing file
        const noPosterPlaceholder = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjQ1MCIgdmlld0JveD0iMCAwIDMwMCA0NTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iNDUwIiBmaWxsPSIjMzMzIi8+Cjx0ZXh0IHg9IjE1MCIgeT0iMjI1IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiPk5vIFBvc3RlcjwvdGV4dD4KPC9zdmc+';
        const poster = item.poster_path || noPosterPlaceholder;
        const mediaTypeIcon = item.media_type === 'movie' ? '🎬' : '📺';
        const rating = item.vote_average ? `⭐ ${item.vote_average.toFixed(1)}` : '';
        
        // Generate availability status
        const availability = item.availability || {};
        const statusInfo = this.getStatusInfo(availability);
        
        return `
            <div class="result-card" data-tmdb-id="${item.tmdb_id}" data-media-type="${item.media_type}">
                <div class="result-poster">
                    <img src="${poster}" alt="${item.title}" onerror="this.src='${noPosterPlaceholder}'">
                    <div class="media-type-badge">${mediaTypeIcon}</div>
                </div>
                <div class="result-info">
                    <h3 class="result-title">${item.title} ${year}</h3>
                    <p class="result-overview">${item.overview.substring(0, 150)}${item.overview.length > 150 ? '...' : ''}</p>
                    <div class="result-meta">
                        <span class="rating">${rating}</span>
                        <span class="media-type">${item.media_type === 'movie' ? 'Movie' : 'TV Show'}</span>
                    </div>
                    <div class="availability-status ${statusInfo.className}">
                        <span class="status-icon">${statusInfo.icon}</span>
                        <span class="status-text">${statusInfo.message}</span>
                    </div>
                    <div class="request-section">
                        <button class="request-btn ${statusInfo.buttonClass}" 
                                data-item='${JSON.stringify(item)}'
                                ${statusInfo.disabled ? 'disabled' : ''}>
                            ${statusInfo.buttonText}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    getStatusInfo(availability) {
        switch (availability.status) {
            case 'available':
                return {
                    icon: '✅',
                    message: availability.message || 'Already in library',
                    className: 'status-available',
                    buttonText: 'In Library',
                    buttonClass: 'btn-disabled',
                    disabled: true
                };
            case 'available_to_request_missing':
                return {
                    icon: '📺',
                    message: availability.message || 'Request missing episodes',
                    className: 'status-missing-episodes',
                    buttonText: 'Request Missing',
                    buttonClass: 'btn-warning',
                    disabled: false
                };
            case 'requested':
                return {
                    icon: '⏳',
                    message: 'Previously requested',
                    className: 'status-requested',
                    buttonText: 'Already Requested',
                    buttonClass: 'btn-disabled',
                    disabled: true
                };
            case 'available_to_request':
                return {
                    icon: '📥',
                    message: availability.message || 'Available to request',
                    className: 'status-requestable',
                    buttonText: 'Request',
                    buttonClass: 'btn-primary',
                    disabled: false
                };
            case 'error':
                return {
                    icon: '❌',
                    message: 'Error checking availability',
                    className: 'status-error',
                    buttonText: 'Error',
                    buttonClass: 'btn-disabled',
                    disabled: true
                };
            default:
                return {
                    icon: '❓',
                    message: 'Unknown status',
                    className: 'status-unknown',
                    buttonText: 'Unknown',
                    buttonClass: 'btn-disabled',
                    disabled: true
                };
        }
    }

    setupRequestButtons() {
        document.querySelectorAll('.request-btn:not([disabled])').forEach(button => {
            button.addEventListener('click', (e) => this.handleRequest(e.target));
        });
    }

    async handleRequest(button) {
        if (button.disabled) return;
        
        try {
            const item = JSON.parse(button.dataset.item);
            console.log('Requesting item:', item);
            console.log('Selected instance:', this.selectedInstance);
            
            button.disabled = true;
            button.textContent = 'Requesting...';
            
            const requestData = {
                tmdb_id: item.tmdb_id,
                media_type: item.media_type,
                title: item.title,
                year: item.year,
                overview: item.overview,
                poster_path: item.poster_path,
                backdrop_path: item.backdrop_path,
                app_type: this.selectedInstance.appType,
                instance_name: this.selectedInstance.instanceName
            };
            
            console.log('Request data:', requestData);
            
            const response = await fetch('./api/requestarr/request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            console.log('Request result:', result);
            
            if (result.success) {
                this.showNotification(result.message, 'success');
                button.textContent = 'Requested';
                button.className = 'request-btn btn-disabled';
                
                // Update availability status
                const statusElement = button.closest('.result-card').querySelector('.availability-status');
                if (statusElement) {
                    statusElement.className = 'availability-status status-requested';
                    statusElement.innerHTML = '<span class="status-icon">⏳</span><span class="status-text">Requested</span>';
                }
                
            } else {
                this.showNotification(result.message || 'Request failed', 'error');
                button.disabled = false;
                button.textContent = 'Request';
            }
            
        } catch (error) {
            console.error('Error requesting media:', error);
            this.showNotification('Request failed', 'error');
            button.disabled = false;
            button.textContent = 'Request';
        }
    }

    clearResults() {
        const resultsContainer = document.getElementById('requestarr-results');
        if (resultsContainer) {
            resultsContainer.innerHTML = '';
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add to page
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('requestarr-section')) {
        window.requestarrModule = new RequestarrModule();
    }
}); 