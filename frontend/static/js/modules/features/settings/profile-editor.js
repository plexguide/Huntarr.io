/**
 * Profile editor (Movie Hunt) - full-page editor like instance editor.
 * Open from Profiles list Edit; Back/Save; sections: Profile details, Upgrade & quality, Qualities.
 * Attaches to window.SettingsForms.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function generateProfileEditorHtml(profile) {
        const p = profile || {};
        const name = escapeHtml((p.name || '').trim() || 'Unnamed');
        const isDefault = Boolean(p.is_default);
        const upgradesAllowed = p.upgrades_allowed !== false;
        const upgradeUntil = escapeHtml((p.upgrade_until_quality || 'WEB 2160p').trim());
        const minScore = p.min_custom_format_score != null ? Number(p.min_custom_format_score) : -10000;
        const untilScore = p.upgrade_until_custom_format_score != null ? Number(p.upgrade_until_custom_format_score) : 5500;
        const increment = p.upgrade_score_increment != null ? Number(p.upgrade_score_increment) : 100;
        const language = escapeHtml((p.language || 'English').trim());
        const qualities = Array.isArray(p.qualities) ? p.qualities : [];
        var checkedQualityNames = [];
        qualities.forEach(function(q) {
            if (q.enabled !== false) {
                var n = (q.name || q.id || '').trim();
                if (n) checkedQualityNames.push(n);
            }
        });
        if (checkedQualityNames.length === 0) {
            checkedQualityNames = ['WEB 2160p', 'WEB 1080p', 'WEB 720p'];
        }
        let qualitiesHtml = '';
        qualities.forEach(function(q, i) {
            const qName = escapeHtml((q.name || q.id || '').trim() || 'Quality');
            const checked = q.enabled !== false ? ' checked' : '';
            qualitiesHtml += '<div class="profile-quality-item" data-quality-id="' + escapeHtml(String(q.id || i)) + '" data-order="' + (q.order != null ? q.order : i) + '" draggable="true">' +
                '<span class="quality-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>' +
                '<input type="checkbox" id="profile-quality-' + i + '" class="profile-quality-checkbox"' + checked + '>' +
                '<label class="quality-name" for="profile-quality-' + i + '">' + qName + '</label>' +
                '</div>';
        });
        var upgradeSelectOptions = '';
        checkedQualityNames.forEach(function(opt) {
            var sel = opt === (p.upgrade_until_quality || 'WEB 2160p').trim() ? ' selected' : '';
            upgradeSelectOptions += '<option value="' + escapeHtml(opt) + '"' + sel + '>' + escapeHtml(opt) + '</option>';
        });
        if (upgradeSelectOptions === '') {
            upgradeSelectOptions = '<option value="WEB 2160p">WEB 2160p</option>';
        }

        return '<div class="editor-grid">' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Profile details</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-name">Name</label>' +
            '<input type="text" id="profile-editor-name" value="' + name + '" placeholder="Profile name" maxlength="64">' +
            '</div><p class="editor-help-text">A friendly name for this profile</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="profile-editor-default">Set as default profile</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="profile-editor-default"' + (isDefault ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">The default profile is used when no other is selected</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Upgrade &amp; quality</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="profile-editor-upgrades">Upgrades allowed</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="profile-editor-upgrades"' + (upgradesAllowed ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">If disabled, qualities will not be upgraded</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-upgrade-until">Upgrade until</label>' +
            '<select id="profile-editor-upgrade-until">' + upgradeSelectOptions + '</select>' +
            '</div><p class="editor-help-text">Once this quality is reached, no further upgrades will be grabbed</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-min-score">Minimum custom format score</label>' +
            '<input type="number" id="profile-editor-min-score" value="' + minScore + '" min="-100000" max="100000">' +
            '</div><p class="editor-help-text">Minimum custom format score allowed to download</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-until-score">Upgrade until custom format score</label>' +
            '<input type="number" id="profile-editor-until-score" value="' + untilScore + '" min="0" max="100000">' +
            '</div><p class="editor-help-text">Once quality cutoff is met, upgrades stop when this score is reached</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-increment">Minimum custom format score increment</label>' +
            '<input type="number" id="profile-editor-increment" value="' + increment + '" min="0" max="10000">' +
            '</div><p class="editor-help-text">Minimum improvement in score between existing and new release to consider an upgrade</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-language">Language</label>' +
            '<input type="text" id="profile-editor-language" value="' + language + '" placeholder="English" maxlength="64">' +
            '</div><p class="editor-help-text">Language for releases</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Qualities</div>' +
            '<p class="editor-help-text" style="margin-bottom: 12px;">Only checked qualities are wanted. Higher in the list is more preferred.</p>' +
            '<div class="profile-quality-list" id="profile-editor-qualities">' + (qualitiesHtml || '<p class="editor-help-text">No qualities defined.</p>') + '</div>' +
            '</div>' +
            '<div class="editor-section profile-editor-scores-section">' +
            '<div class="editor-section-title">Custom format scores</div>' +
            '<p class="editor-help-text" style="margin-bottom: 12px;">Hunt Manager uses these scores to decide which release to grab. Higher total score means a better release. Start at 0; use the Recommend column (from <a href="https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/" target="_blank" rel="noopener">TRaSH Guides</a>) as a guide if you want. To incorporate customized formats for your movies, <a href="./#settings-custom-formats" class="editor-inline-link">visit Custom Formats</a>.</p>' +
            '<div class="profile-editor-scores-container">' +
            '<table class="profile-editor-scores-table"><thead><tr><th>Custom format</th><th class="th-score">Your score</th><th class="th-recommended">Recommend</th></tr></thead>' +
            '<tbody id="profile-editor-scores-tbody"></tbody></table>' +
            '<p id="profile-editor-scores-empty" class="profile-editor-scores-empty" style="display: none;">No custom formats added yet. Add them under Movie Hunt &rarr; Custom Formats, then set scores here.</p>' +
            '</div></div></div>';
    }

    let _profileEditorScoresList = [];
    let _profileEditorScoresSortTimeout = null;
    let _profileEditorDirty = false;

    function renderProfileEditorScoresTable() {
        const tbody = document.getElementById('profile-editor-scores-tbody');
        const emptyEl = document.getElementById('profile-editor-scores-empty');
        const table = document.querySelector('.profile-editor-scores-table');
        if (!tbody || _profileEditorScoresList.length === 0) {
            if (tbody) tbody.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            if (table) table.style.display = 'none';
            return;
        }
        const sorted = _profileEditorScoresList.slice().sort(function(a, b) { return (b.score - a.score); });
        let html = '';
        for (let i = 0; i < sorted.length; i++) {
            const item = sorted[i];
            const title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const rec = item.recommended_score;
            const recText = (rec != null && !isNaN(rec)) ? String(rec) : '—';
            html += '<tr data-index="' + item.index + '"><td><span class="custom-format-score-name">' + title + '</span></td>' +
                '<td><input type="number" class="profile-editor-score-input" data-index="' + item.index + '" value="' + item.score + '" min="-100000" max="100000" step="1"></td>' +
                '<td><span class="recommended-value">' + recText + '</span></td></tr>';
        }
        tbody.innerHTML = html;
        tbody.querySelectorAll('.profile-editor-score-input').forEach(function(input) {
            function scheduleSort(idx) {
                if (_profileEditorScoresSortTimeout) clearTimeout(_profileEditorScoresSortTimeout);
                _profileEditorScoresSortTimeout = setTimeout(function() {
                    _profileEditorScoresSortTimeout = null;
                    renderProfileEditorScoresTable();
                }, 2000);
            }
            input.addEventListener('input', function() {
                const idx = parseInt(input.getAttribute('data-index'), 10);
                if (isNaN(idx)) return;
                let val = parseInt(input.value, 10);
                if (isNaN(val)) val = 0;
                const item = _profileEditorScoresList.find(function(o) { return o.index === idx; });
                if (item) item.score = val;
                markProfileEditorDirty();
                scheduleSort(idx);
            });
            input.addEventListener('change', function() {
                const idx = parseInt(input.getAttribute('data-index'), 10);
                if (isNaN(idx)) return;
                let val = parseInt(input.value, 10);
                if (isNaN(val)) val = 0;
                const item = _profileEditorScoresList.find(function(o) { return o.index === idx; });
                if (item) item.score = val;
                markProfileEditorDirty();
                scheduleSort(idx);
            });
        });
    }

    function loadProfileEditorScoresTable() {
        const tbody = document.getElementById('profile-editor-scores-tbody');
        const emptyEl = document.getElementById('profile-editor-scores-empty');
        const table = document.querySelector('.profile-editor-scores-table');
        if (!tbody) return;
        fetch('./api/custom-formats')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                const list = (data && data.custom_formats) ? data.custom_formats : [];
                if (list.length === 0) {
                    _profileEditorScoresList = [];
                    tbody.innerHTML = '';
                    if (emptyEl) emptyEl.style.display = 'block';
                    if (table) table.style.display = 'none';
                    return;
                }
                if (emptyEl) emptyEl.style.display = 'none';
                if (table) table.style.display = 'table';
                _profileEditorScoresList = list.map(function(item, i) {
                    let score = item.score != null ? Number(item.score) : 0;
                    if (isNaN(score)) score = 0;
                    return {
                        index: i,
                        title: item.title || item.name || 'Unnamed',
                        name: item.name || 'Unnamed',
                        recommended_score: item.recommended_score,
                        score: score
                    };
                });
                renderProfileEditorScoresTable();
            })
            .catch(function() {
                _profileEditorScoresList = [];
                tbody.innerHTML = '';
                if (emptyEl) emptyEl.style.display = 'block';
                if (table) table.style.display = 'none';
            });
    }

    function saveProfileEditorScores() {
        if (!_profileEditorScoresList || _profileEditorScoresList.length === 0) return Promise.resolve();
        const tbody = document.getElementById('profile-editor-scores-tbody');
        if (!tbody) return Promise.resolve();
        const rows = tbody.querySelectorAll('tr[data-index]');
        var scores = _profileEditorScoresList.slice().map(function(o) { return o.score; });
        rows.forEach(function(row) {
            const idx = parseInt(row.getAttribute('data-index'), 10);
            const input = row.querySelector('.profile-editor-score-input');
            if (isNaN(idx) || idx < 0 || idx >= scores.length || !input) return;
            let val = parseInt(input.value, 10);
            if (isNaN(val)) val = 0;
            scores[idx] = val;
        });
        return fetch('./api/custom-formats/scores', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scores: scores })
        }).then(function(r) { return r.json(); });
    }

    function markProfileEditorDirty() {
        _profileEditorDirty = true;
        const saveBtn = document.getElementById('profile-editor-save');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
    }

    function confirmLeaveProfileEditor(done) {
        if (!_profileEditorDirty) {
            if (typeof done === 'function') done('discard');
            return true;
        }
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes that will be lost if you leave.',
                confirmLabel: 'Go Back',
                cancelLabel: 'Leave',
                onConfirm: function() {
                    // Stay on the editor — modal just closes, user can save manually
                },
                onCancel: function() {
                    if (typeof done === 'function') done('discard');
                }
            });
        } else {
            if (!confirm('You have unsaved changes that will be lost. Leave anyway?')) return;
            if (typeof done === 'function') done('discard');
        }
        return false;
    }

    function getCheckedQualityNamesInOrder() {
        const list = document.getElementById('profile-editor-qualities');
        if (!list) return [];
        const items = list.querySelectorAll('.profile-quality-item');
        var names = [];
        items.forEach(function(item) {
            var cb = item.querySelector('.profile-quality-checkbox');
            var label = item.querySelector('.quality-name');
            if (cb && cb.checked && label) {
                var n = (label.textContent || '').trim();
                if (n) names.push(n);
            }
        });
        return names;
    }

    function refreshProfileEditorUpgradeUntilOptions() {
        const select = document.getElementById('profile-editor-upgrade-until');
        if (!select) return;
        const names = getCheckedQualityNamesInOrder();
        const currentValue = (select.value || '').trim();
        var optionsHtml = '';
        names.forEach(function(n) {
            var sel = n === currentValue ? ' selected' : '';
            optionsHtml += '<option value="' + n.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') + '"' + sel + '>' + n.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</option>';
        });
        if (optionsHtml === '') {
            optionsHtml = '<option value="">No qualities checked</option>';
        }
        select.innerHTML = optionsHtml;
        if (names.length > 0 && (currentValue === '' || names.indexOf(currentValue) === -1)) {
            select.value = names[0];
        }
    }

    function setupProfileEditorChangeDetection() {
        const content = document.getElementById('profile-editor-content');
        const saveBtn = document.getElementById('profile-editor-save');
        if (!content || !saveBtn) return;
        content.querySelectorAll('input:not(.profile-quality-checkbox), select').forEach(function(el) {
            el.addEventListener('input', markProfileEditorDirty);
            el.addEventListener('change', markProfileEditorDirty);
        });
        var qualitiesList = document.getElementById('profile-editor-qualities');
        if (qualitiesList) {
            qualitiesList.addEventListener('change', function(e) {
                if (e.target && e.target.classList.contains('profile-quality-checkbox')) {
                    markProfileEditorDirty();
                    refreshProfileEditorUpgradeUntilOptions();
                }
            });
        }
    }

    function setupProfileQualitiesDragDrop() {
        const list = document.getElementById('profile-editor-qualities');
        if (!list) return;
        const items = list.querySelectorAll('.profile-quality-item');
        if (items.length === 0) return;
        let draggedEl = null;
        items.forEach(function(item) {
            item.setAttribute('draggable', 'true');
            item.addEventListener('dragstart', function(e) {
                draggedEl = item;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.getAttribute('data-quality-id') || '');
                e.dataTransfer.setData('text/html', item.outerHTML);
                item.classList.add('profile-quality-dragging');
                e.dataTransfer.setDragImage(item, 0, 0);
            });
            item.addEventListener('dragend', function() {
                item.classList.remove('profile-quality-dragging');
                list.querySelectorAll('.profile-quality-item').forEach(function(el) {
                    el.classList.remove('profile-quality-drag-over');
                });
                draggedEl = null;
            });
            item.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedEl && draggedEl !== item) {
                    item.classList.add('profile-quality-drag-over');
                }
            });
            item.addEventListener('dragleave', function() {
                item.classList.remove('profile-quality-drag-over');
            });
            item.addEventListener('drop', function(e) {
                e.preventDefault();
                item.classList.remove('profile-quality-drag-over');
                if (!draggedEl || draggedEl === item) return;
                var parent = item.parentNode;
                parent.insertBefore(draggedEl, item);
                markProfileEditorDirty();
                refreshProfileEditorUpgradeUntilOptions();
            });
        });
        list.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
    }

    Forms.openProfileEditor = function(index) {
        const list = Forms._profilesList;
        if (!list || !list[index]) {
            fetch('./api/profiles')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    const profiles = (data && data.profiles) ? data.profiles : [];
                    Forms._profilesList = profiles;
                    if (profiles[index]) {
                        Forms._openProfileEditorWithProfile(index, profiles[index]);
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Profile not found.', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to load profile.', 'error');
                    }
                });
            return;
        }
        Forms._openProfileEditorWithProfile(index, list[index]);
    };

    Forms._openProfileEditorWithProfile = function(index, profile) {
        _profileEditorDirty = false;
        Forms._currentProfileEditing = { index: index, originalProfile: JSON.parse(JSON.stringify(profile)) };
        const contentEl = document.getElementById('profile-editor-content');
        const saveBtn = document.getElementById('profile-editor-save');
        const backBtn = document.getElementById('profile-editor-back');
        if (!contentEl) return;
        contentEl.innerHTML = generateProfileEditorHtml(profile);
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.classList.remove('enabled');
            saveBtn.onclick = function() { Forms.saveProfileFromEditor(); };
        }
        if (backBtn) {
            backBtn.onclick = function() {
                confirmLeaveProfileEditor(function(result) {
                    if (result === 'save') Forms.saveProfileFromEditor('settings-profiles');
                    else if (result === 'discard') Forms.cancelProfileEditor();
                });
            };
        }
        setTimeout(function() {
            setupProfileEditorChangeDetection();
            setupProfileQualitiesDragDrop();
            refreshProfileEditorUpgradeUntilOptions();
            loadProfileEditorScoresTable();
        }, 100);
        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection('profile-editor');
        }
    };

    Forms.saveProfileFromEditor = function(optionalNextSection) {
        const state = Forms._currentProfileEditing;
        if (!state) return;
        const nextSection = optionalNextSection || 'settings-profiles';
        const index = state.index;
        const nameEl = document.getElementById('profile-editor-name');
        const defaultEl = document.getElementById('profile-editor-default');
        const upgradesEl = document.getElementById('profile-editor-upgrades');
        const upgradeUntilEl = document.getElementById('profile-editor-upgrade-until');
        const minScoreEl = document.getElementById('profile-editor-min-score');
        const untilScoreEl = document.getElementById('profile-editor-until-score');
        const incrementEl = document.getElementById('profile-editor-increment');
        const languageEl = document.getElementById('profile-editor-language');
        const qualitiesContainer = document.getElementById('profile-editor-qualities');
        const name = (nameEl && nameEl.value) ? nameEl.value.trim() : 'Unnamed';
        const isDefault = defaultEl ? defaultEl.checked : false;
        const upgradesAllowed = upgradesEl ? upgradesEl.checked : true;
        const upgradeUntil = (upgradeUntilEl && upgradeUntilEl.value) ? upgradeUntilEl.value.trim() : 'WEB 2160p';
        const minScore = minScoreEl ? parseInt(minScoreEl.value, 10) : -10000;
        const untilScore = untilScoreEl ? parseInt(untilScoreEl.value, 10) : 5500;
        const increment = incrementEl ? parseInt(incrementEl.value, 10) : 100;
        const language = (languageEl && languageEl.value) ? languageEl.value.trim() : 'English';
        const qualities = [];
        if (qualitiesContainer) {
            const items = qualitiesContainer.querySelectorAll('.profile-quality-item');
            items.forEach(function(item, i) {
                const cb = item.querySelector('input[type="checkbox"]');
                const label = item.querySelector('.quality-name');
                qualities.push({
                    id: item.getAttribute('data-quality-id') || 'q' + i,
                    name: label ? label.textContent.trim() : ('Quality ' + i),
                    enabled: cb ? cb.checked : true,
                    order: i
                });
            });
        }
        const body = {
            name: name,
            is_default: isDefault,
            upgrades_allowed: upgradesAllowed,
            upgrade_until_quality: upgradeUntil,
            min_custom_format_score: isNaN(minScore) ? -10000 : minScore,
            upgrade_until_custom_format_score: isNaN(untilScore) ? 5500 : untilScore,
            upgrade_score_increment: isNaN(increment) ? 100 : increment,
            language: language,
            qualities: qualities
        };
        const saveBtn = document.getElementById('profile-editor-save');
        if (saveBtn) saveBtn.disabled = true;
        fetch('./api/profiles/' + index, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _profileEditorDirty = false;
                    saveProfileEditorScores().then(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Profile saved.', 'success');
                        }
                        if (optionalNextSection != null && window.huntarrUI && window.huntarrUI.switchSection) {
                            window.huntarrUI.switchSection(nextSection);
                        }
                        if (Forms.refreshProfilesList) Forms.refreshProfilesList();
                    }).catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Profile saved; some scores may not have saved.', 'warning');
                        }
                        if (optionalNextSection != null && window.huntarrUI && window.huntarrUI.switchSection) {
                            window.huntarrUI.switchSection(nextSection);
                        }
                        if (Forms.refreshProfilesList) Forms.refreshProfilesList();
                    });
                } else {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error || 'Failed to save.', 'error');
                    }
                    if (saveBtn) saveBtn.disabled = false;
                    saveBtn.classList.add('enabled');
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to save profile.', 'error');
                }
                if (saveBtn) saveBtn.disabled = false;
                saveBtn.classList.add('enabled');
            });
    };

    Forms.cancelProfileEditor = function(optionalNextSection) {
        _profileEditorDirty = false;
        Forms._currentProfileEditing = null;
        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection(optionalNextSection || 'settings-profiles');
        }
    };

    Forms.isProfileEditorDirty = function() {
        return !!_profileEditorDirty;
    };

    Forms.confirmLeaveProfileEditor = function(callback) {
        confirmLeaveProfileEditor(callback);
    };
})();
