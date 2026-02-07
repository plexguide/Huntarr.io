/**
 * NZB Hunt - Standalone JavaScript module
 * Independent: does not share state with Movie Hunt, Requestarr, or any other module.
 * Manages NZB Home, Activity (coming soon), and Settings (coming soon).
 */
(function() {
    'use strict';

    window.NzbHunt = {
        currentTab: 'queue',

        init: function() {
            this.setupTabs();
            this.showTab('queue');
            console.log('[NzbHunt] Initialized');
        },

        setupTabs: function() {
            var self = this;
            var tabs = document.querySelectorAll('#nzb-hunt-section .nzb-tab');
            tabs.forEach(function(tab) {
                tab.addEventListener('click', function() {
                    var target = tab.getAttribute('data-tab');
                    if (target) self.showTab(target);
                });
            });
        },

        showTab: function(tab) {
            this.currentTab = tab;

            // Update tab active states
            var tabs = document.querySelectorAll('#nzb-hunt-section .nzb-tab');
            tabs.forEach(function(t) {
                t.classList.toggle('active', t.getAttribute('data-tab') === tab);
            });

            // Show/hide tab panels
            var panels = document.querySelectorAll('#nzb-hunt-section .nzb-tab-panel');
            panels.forEach(function(p) {
                p.style.display = p.getAttribute('data-panel') === tab ? 'block' : 'none';
            });
        }
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.NzbHunt.init(); });
    } else {
        window.NzbHunt.init();
    }
})();
