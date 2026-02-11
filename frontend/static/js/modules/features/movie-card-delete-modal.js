/**
 * Movie Card Delete Modal - Shared delete/remove modal for movie cards.
 * Used by: requestarr-content.js, movie-hunt.js, movie-hunt-collection.js
 *
 * Opens a modal with options:
 *   - Remove from Library (always, checked by default)
 *   - Delete Movie Files (only if hasFile, unchecked by default)
 *   - Add to Hidden Media (always last, unchecked by default)
 *
 * Checkbox states are persisted server-side in general_settings.
 */
(function() {
    'use strict';

    var _prefsLoaded = false;
    var _prefs = { remove_from_library: true, delete_files: false, add_to_hidden: false };

    function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function loadPrefs() {
        if (_prefsLoaded) return Promise.resolve(_prefs);
        return fetch('./api/settings')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var general = data.general || data;
                var raw = general.movie_hunt_delete_prefs;
                if (raw) {
                    try {
                        var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        if (parsed.remove_from_library !== undefined) _prefs.remove_from_library = !!parsed.remove_from_library;
                        if (parsed.delete_files !== undefined) _prefs.delete_files = !!parsed.delete_files;
                        if (parsed.add_to_hidden !== undefined) _prefs.add_to_hidden = !!parsed.add_to_hidden;
                    } catch (e) { /* use defaults */ }
                }
                _prefsLoaded = true;
                return _prefs;
            })
            .catch(function() {
                _prefsLoaded = true;
                return _prefs;
            });
    }

    function savePrefs(prefs) {
        var payload = { movie_hunt_delete_prefs: JSON.stringify(prefs) };
        fetch('./api/settings/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(function(e) {
            console.warn('[MovieCardDeleteModal] Failed to save prefs:', e);
        });
    }

    /**
     * Open the delete modal.
     * @param {Object} item - Movie data (title, year, tmdb_id, poster_path, status, etc.)
     * @param {Object} options
     *   - instanceName {string} - Movie Hunt instance display name
     *   - instanceId {string|number} - Instance ID for API calls
     *   - status {string} - 'available' or 'requested'
     *   - hasFile {boolean} - Whether movie files exist on disk
     *   - filePath {string} - Display path for the movie file/folder
     *   - onDeleted {function} - Callback after successful deletion
     *   - appType {string} - 'movie_hunt' or 'radarr' (default: 'movie_hunt')
     */
    function open(item, options) {
        options = options || {};
        var title = escapeHtml(item.title || 'Unknown');
        var year = item.year || '';
        var status = (options.status || item.status || 'requested').toLowerCase();
        var hasFile = !!(options.hasFile || (status === 'available'));
        var filePath = options.filePath || '';
        var folderDisplay = filePath ? escapeHtml(filePath) : escapeHtml(item.title + (year ? ' (' + year + ')' : ''));
        var appType = options.appType || 'movie_hunt';

        loadPrefs().then(function(prefs) {
            buildModal(item, options, title, status, hasFile, folderDisplay, prefs, appType);
        });
    }

    function buildModal(item, options, title, status, hasFile, folderDisplay, prefs, appType) {
        // Remove existing modal
        var existing = document.getElementById('mh-card-delete-modal');
        if (existing) existing.remove();

        var removeChecked = prefs.remove_from_library ? ' checked' : '';
        var deleteFilesChecked = prefs.delete_files ? ' checked' : '';
        var hiddenChecked = prefs.add_to_hidden ? ' checked' : '';

        var html =
            '<div class="mh-modal-backdrop" id="mh-card-delete-modal">' +
                '<div class="mh-modal">' +
                    '<div class="mh-modal-header mh-modal-header-danger">' +
                        '<h3><i class="fas fa-trash-alt"></i> Delete \u2014 ' + title + '</h3>' +
                        '<button class="mh-modal-x" id="mh-cdm-close">&times;</button>' +
                    '</div>' +
                    '<div class="mh-modal-body">' +
                        '<div class="mh-delete-path" title="' + folderDisplay + '">' +
                            '<i class="fas fa-folder"></i> <span class="mh-delete-path-text">' + folderDisplay + '</span>' +
                        '</div>' +

                        // Option 1: Remove from Library (always shown)
                        '<label class="mh-check-row">' +
                            '<input type="checkbox" id="mh-cdm-remove"' + removeChecked + '>' +
                            '<div><strong>Remove from Library</strong>' +
                            '<div class="mh-help">Remove this movie from your Movie Hunt collection</div></div>' +
                        '</label>' +

                        // Option 2: Delete Movie Files (only for available items)
                        (hasFile ? (
                            '<label class="mh-check-row">' +
                                '<input type="checkbox" id="mh-cdm-delete-files"' + deleteFilesChecked + '>' +
                                '<div><strong>Delete Movie Files</strong>' +
                                '<div class="mh-help">Delete the movie files and movie folder from disk</div></div>' +
                            '</label>'
                        ) : '') +

                        // Option 3: Add to Hidden Media (always last)
                        '<label class="mh-check-row">' +
                            '<input type="checkbox" id="mh-cdm-hidden"' + hiddenChecked + '>' +
                            '<div><strong>Add to Hidden Media</strong>' +
                            '<div class="mh-help">Hide from discovery pages so it won\'t be re-suggested</div></div>' +
                        '</label>' +

                    '</div>' +
                    '<div class="mh-modal-footer">' +
                        '<button class="mh-btn mh-btn-secondary" id="mh-cdm-cancel">Close</button>' +
                        '<button class="mh-btn mh-btn-danger" id="mh-cdm-confirm">Delete</button>' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.insertAdjacentHTML('beforeend', html);

        // Wire close handlers
        var closeModal = function() {
            var el = document.getElementById('mh-card-delete-modal');
            if (el) el.remove();
        };
        document.getElementById('mh-cdm-close').addEventListener('click', closeModal);
        document.getElementById('mh-cdm-cancel').addEventListener('click', closeModal);
        document.getElementById('mh-card-delete-modal').addEventListener('click', function(e) {
            if (e.target.id === 'mh-card-delete-modal') closeModal();
        });

        // Wire confirm
        document.getElementById('mh-cdm-confirm').addEventListener('click', function() {
            handleConfirm(item, options, hasFile, appType, closeModal);
        });
    }

    function handleConfirm(item, options, hasFile, appType, closeModal) {
        var removeFromLib = document.getElementById('mh-cdm-remove')
            ? document.getElementById('mh-cdm-remove').checked : true;
        var deleteFiles = document.getElementById('mh-cdm-delete-files')
            ? document.getElementById('mh-cdm-delete-files').checked : false;
        var addToHidden = document.getElementById('mh-cdm-hidden')
            ? document.getElementById('mh-cdm-hidden').checked : false;

        // Save prefs
        var newPrefs = {
            remove_from_library: removeFromLib,
            delete_files: deleteFiles,
            add_to_hidden: addToHidden
        };
        _prefs = newPrefs;
        savePrefs(newPrefs);

        var delBtn = document.getElementById('mh-cdm-confirm');
        if (delBtn) { delBtn.disabled = true; delBtn.textContent = 'Deleting...'; }

        var tmdbId = item.tmdb_id || item.id;
        var instanceId = options.instanceId || '';
        var instanceName = options.instanceName || '';
        var promises = [];

        // 1. Remove from library
        if (removeFromLib) {
            var removePromise = fetch('./api/movie-hunt/collection/remove?instance_id=' + encodeURIComponent(instanceId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    title: item.title || '',
                    year: String(item.year || ''),
                    add_to_blocklist: false,
                    delete_files: deleteFiles
                })
            }).then(function(r) { return r.json(); });
            promises.push(removePromise);
        }

        // 2. Add to hidden media
        if (addToHidden && tmdbId && instanceName) {
            var hidePromise = fetch('./api/requestarr/hidden-media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    media_type: 'movie',
                    title: item.title || '',
                    poster_path: item.poster_path || null,
                    app_type: appType,
                    instance_name: instanceName
                })
            }).then(function(r) { return r.json(); });
            promises.push(hidePromise);
        }

        if (promises.length === 0) {
            // Nothing selected, just close
            closeModal();
            return;
        }

        Promise.all(promises)
            .then(function() {
                closeModal();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('"' + (item.title || 'Movie') + '" removed.', 'success');
                }
                if (typeof options.onDeleted === 'function') {
                    options.onDeleted();
                }
            })
            .catch(function(err) {
                console.error('[MovieCardDeleteModal] Error:', err);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Delete failed: ' + (err.message || 'Unknown error'), 'error');
                }
                if (delBtn) { delBtn.disabled = false; delBtn.textContent = 'Delete'; }
            });
    }

    window.MovieCardDeleteModal = { open: open };
})();
