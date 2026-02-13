/**
 * Requestarr bundle entry - imports in correct order for Vite.
 * 1. SmartHunt first (sets window.SmartHunt)
 * 2. Controller (sets up RequestarrDiscover via core)
 * 3. Home (needs window.SmartHunt, runs init)
 */
import './requestarr-smarthunt.js';
import './requestarr-controller.js';
import './requestarr-home.js';
