/**
 * Media Hunt Instance Management – shows Movie/TV instance list.
 * Delegates to MovieHuntInstanceEditor or TVHuntInstanceEditor based on mode.
 */
(function() {
    'use strict';

    window.MediaHuntInstanceManagement = window.MediaHuntInstanceManagement || {};

    window.MediaHuntInstanceManagement.init = function() {
        var mode = window._mediaHuntInstanceManagementMode || 'movie';
        if (mode === 'tv' && window.TVHuntInstanceEditor && typeof window.TVHuntInstanceEditor.loadInstanceList === 'function') {
            window.TVHuntInstanceEditor.loadInstanceList();
        } else if (window.MovieHuntInstanceEditor && typeof window.MovieHuntInstanceEditor.loadInstanceList === 'function') {
            window.MovieHuntInstanceEditor.loadInstanceList();
        }
    };
})();
