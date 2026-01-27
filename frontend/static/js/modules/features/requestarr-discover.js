/**
 * Requestarr Discover - Main entry point
 * Loads ES6 modules for a modular architecture
 */

import { RequestarrDiscover } from './requestarr/requestarr-core.js';

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.RequestarrDiscover = new RequestarrDiscover();
    console.log('[RequestarrDiscover] Modules loaded successfully');
});
