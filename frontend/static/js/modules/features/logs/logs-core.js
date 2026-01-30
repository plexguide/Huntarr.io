/**
 * Logs Module
 * Handles log streaming, searching, and filtering
 */

window.HuntarrLogs = {
    autoScrollWasEnabled: false,

    connectToLogs: function() {
        if (window.LogsModule && typeof window.LogsModule.connectToLogs === 'function') {
            window.LogsModule.connectToLogs();
        }
    },
    
    clearLogs: function() {
        if (window.LogsModule && typeof window.LogsModule.clearLogs === 'function') {
            window.LogsModule.clearLogs(true); // true = from user action (e.g. button/menu)
        }
    },
    
    insertLogInChronologicalOrder: function(newLogEntry) {
        if (!window.huntarrUI || !window.huntarrUI.elements.logsContainer || !newLogEntry) return;
        
        const logsContainer = window.huntarrUI.elements.logsContainer;
        const newTimestamp = this.parseLogTimestamp(newLogEntry);
        
        if (!newTimestamp) {
            logsContainer.appendChild(newLogEntry);
            return;
        }
        
        const existingEntries = Array.from(logsContainer.children);
        
        if (existingEntries.length === 0) {
            logsContainer.appendChild(newLogEntry);
            return;
        }
        
        let insertPosition = null;
        
        for (let i = 0; i < existingEntries.length; i++) {
            const existingTimestamp = this.parseLogTimestamp(existingEntries[i]);
            if (!existingTimestamp) continue;
            
            if (newTimestamp > existingTimestamp) {
                insertPosition = existingEntries[i];
                break;
            }
        }
        
        if (insertPosition) {
            logsContainer.insertBefore(newLogEntry, insertPosition);
        } else {
            logsContainer.appendChild(newLogEntry);
        }
    },
    
    parseLogTimestamp: function(logEntry) {
        if (!logEntry) return null;
        
        try {
            const dateSpan = logEntry.querySelector('.log-timestamp .date');
            const timeSpan = logEntry.querySelector('.log-timestamp .time');
            
            if (!dateSpan || !timeSpan) return null;
            
            const dateText = dateSpan.textContent.trim();
            const timeText = timeSpan.textContent.trim();
            
            if (!dateText || !timeText || dateText === '--' || timeText === '--:--:--') {
                return null;
            }
            
            const timestampString = `${dateText} ${timeText}`;
            const timestamp = new Date(timestampString);
            
            return isNaN(timestamp.getTime()) ? null : timestamp;
        } catch (error) {
            console.warn('[HuntarrLogs] Error parsing log timestamp:', error);
            return null;
        }
    },
    
    searchLogs: function() {
        if (!window.huntarrUI || !window.huntarrUI.elements.logsContainer || !window.huntarrUI.elements.logSearchInput) return;
        
        const logsContainer = window.huntarrUI.elements.logsContainer;
        const logSearchInput = window.huntarrUI.elements.logSearchInput;
        const searchText = logSearchInput.value.trim().toLowerCase();
        
        if (!searchText) {
            this.clearLogSearch();
            return;
        }
        
        if (window.huntarrUI.elements.clearSearchButton) {
            window.huntarrUI.elements.clearSearchButton.style.display = 'block';
        }
        
        const logEntries = Array.from(logsContainer.querySelectorAll('.log-table-row'));
        let matchCount = 0;
        
        const MAX_ENTRIES_TO_PROCESS = 300;
        const processedLogEntries = logEntries.slice(0, MAX_ENTRIES_TO_PROCESS);
        const remainingCount = Math.max(0, logEntries.length - MAX_ENTRIES_TO_PROCESS);
        
        processedLogEntries.forEach((entry) => {
            const entryText = entry.textContent.toLowerCase();
            
            if (entryText.includes(searchText)) {
                entry.style.display = '';
                matchCount++;
                this.simpleHighlightMatch(entry, searchText);
            } else {
                entry.style.display = 'none';
            }
        });
        
        if (remainingCount > 0) {
            logEntries.slice(MAX_ENTRIES_TO_PROCESS).forEach(entry => {
                const entryText = entry.textContent.toLowerCase();
                if (entryText.includes(searchText)) {
                    entry.style.display = '';
                    matchCount++;
                } else {
                    entry.style.display = 'none';
                }
            });
        }
        
        if (window.huntarrUI.elements.logSearchResults) {
            window.huntarrUI.elements.logSearchResults.textContent = `Found ${matchCount} matching log entries`;
            window.huntarrUI.elements.logSearchResults.style.display = 'block';
        }
        
        if (window.huntarrUI.elements.autoScrollCheckbox && window.huntarrUI.elements.autoScrollCheckbox.checked) {
            this.autoScrollWasEnabled = true;
            window.huntarrUI.elements.autoScrollCheckbox.checked = false;
        }
    },
    
    simpleHighlightMatch: function(logEntry, searchText) {
        if (searchText.length < 2) return;
        
        if (!logEntry.hasAttribute('data-original-html')) {
            logEntry.setAttribute('data-original-html', logEntry.innerHTML);
        }
        
        const html = logEntry.getAttribute('data-original-html');
        const escapedSearchText = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedSearchText})`, 'gi');
        const newHtml = html.replace(regex, '<span class="search-highlight">$1</span>');
        
        logEntry.innerHTML = newHtml;
    },
    
    clearLogSearch: function() {
        if (!window.huntarrUI || !window.huntarrUI.elements.logsContainer) return;
        
        const logsContainer = window.huntarrUI.elements.logsContainer;
        
        if (window.huntarrUI.elements.logSearchInput) {
            window.huntarrUI.elements.logSearchInput.value = '';
        }
        
        if (window.huntarrUI.elements.clearSearchButton) {
            window.huntarrUI.elements.clearSearchButton.style.display = 'none';
        }
        
        if (window.huntarrUI.elements.logSearchResults) {
            window.huntarrUI.elements.logSearchResults.style.display = 'none';
        }
        
        const allLogEntries = logsContainer.querySelectorAll('.log-table-row');
        
        Array.from(allLogEntries).forEach(entry => {
            entry.style.display = '';
            if (entry.hasAttribute('data-original-html')) {
                entry.innerHTML = entry.getAttribute('data-original-html');
            }
        });
        
        if (this.autoScrollWasEnabled && window.huntarrUI.elements.autoScrollCheckbox) {
            window.huntarrUI.elements.autoScrollCheckbox.checked = true;
            this.autoScrollWasEnabled = false;
        }
    },

    filterLogsByLevel: function(selectedLevel) {
        if (!window.huntarrUI || !window.huntarrUI.elements.logsContainer) return;
        
        const logsContainer = window.huntarrUI.elements.logsContainer;
        const logEntries = logsContainer.querySelectorAll('.log-table-row');
        let visibleCount = 0;
        let totalCount = logEntries.length;
        
        logEntries.forEach(entry => {
            if (selectedLevel === 'all') {
                entry.style.display = '';
                entry.removeAttribute('data-hidden-by-filter');
                visibleCount++;
            } else {
                const levelBadge = entry.querySelector('.log-level-badge');
                if (levelBadge) {
                    const level = levelBadge.textContent.trim().toLowerCase();
                    if (level === selectedLevel.toLowerCase()) {
                        entry.style.display = '';
                        entry.removeAttribute('data-hidden-by-filter');
                        visibleCount++;
                    } else {
                        entry.style.display = 'none';
                        entry.setAttribute('data-hidden-by-filter', 'true');
                    }
                } else {
                    entry.style.display = 'none';
                    entry.setAttribute('data-hidden-by-filter', 'true');
                }
            }
        });
        
        if (window.huntarrUI.autoScroll && window.huntarrUI.elements.autoScrollCheckbox && window.huntarrUI.elements.autoScrollCheckbox.checked && visibleCount > 0) {
            setTimeout(() => {
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            }, 100);
        }
        
        console.log(`[HuntarrLogs] Filtered logs by level '${selectedLevel}': showing ${visibleCount}/${totalCount} entries`);
    },

    applyFilterToSingleEntry: function(logEntry, selectedLevel) {
        if (!logEntry || selectedLevel === 'all') return;
        
        const levelBadge = logEntry.querySelector('.log-level-badge');
        if (levelBadge) {
            const level = levelBadge.textContent.trim().toLowerCase();
            if (level !== selectedLevel.toLowerCase()) {
                logEntry.style.display = 'none';
                logEntry.setAttribute('data-hidden-by-filter', 'true');
            }
        } else {
            logEntry.style.display = 'none';
            logEntry.setAttribute('data-hidden-by-filter', 'true');
        }
    }
};
