/**
 * Scheduling functionality for Huntarr
 * Implements time-based enable/disable and API cap scheduling.
 *
 * Instance identification uses stable instance_id values (not array indices).
 * Schedule `app` field format:
 *   "global"          → all apps, all instances
 *   "sonarr::all"     → all sonarr instances
 *   "sonarr::<id>"    → specific sonarr instance by instance_id
 */

window.huntarrSchedules = window.huntarrSchedules || {
    global: [],
    sonarr: [],
    radarr: [],
    lidarr: [],
    readarr: [],
    whisparr: [],
    eros: [],
    movie_hunt: [],
    tv_hunt: []
};

(function() {
    const schedules = window.huntarrSchedules;

    function capitalizeFirst(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    }

    // ---------------------------------------------------------------
    // Initialization
    // ---------------------------------------------------------------

    document.addEventListener('DOMContentLoaded', function() {
        initScheduler();
    });

    function initScheduler() {
        console.debug('[Scheduler] Initializing');
        loadSchedules();
        loadAppInstances();
        setupEventListeners();
        initializeTimeInputs();
        loadServerTimezone();
    }

    function setupEventListeners() {
        if (window.huntarrSchedulerInitialized) return;

        const addBtn = document.getElementById('addScheduleButton');
        if (addBtn) {
            addBtn.addEventListener('click', addSchedule);
        }

        document.addEventListener('click', function(e) {
            const deleteBtn = e.target.closest('.delete-schedule');
            if (deleteBtn) {
                e.preventDefault();
                e.stopPropagation();
                const scheduleId = deleteBtn.dataset.id;
                const appType = deleteBtn.dataset.appType || 'global';

                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({
                        title: 'Delete Schedule',
                        message: 'Are you sure you want to delete this schedule?',
                        confirmLabel: 'Delete',
                        onConfirm: function() { deleteSchedule(scheduleId, appType); }
                    });
                } else {
                    if (confirm('Are you sure you want to delete this schedule?')) {
                        deleteSchedule(scheduleId, appType);
                    }
                }
            }
        });

        window.huntarrSchedulerInitialized = true;
    }

    // ---------------------------------------------------------------
    // Load app instances into BOTH the App Type and Instance dropdowns
    // ---------------------------------------------------------------

    async function loadAppInstances() {
        const appTypeSelect = document.getElementById('scheduleAppType');
        const instanceSelect = document.getElementById('scheduleInstance');
        if (!appTypeSelect || !instanceSelect) return;

        try {
            // Fetch standard app settings, Movie Hunt instances, and TV Hunt instances in parallel (cache-bust for fresh data)
            const _ts = Date.now();
            const [settingsResp, movieHuntResp, tvHuntResp] = await Promise.all([
                HuntarrUtils.fetchWithTimeout(`./api/settings?t=${_ts}`),
                HuntarrUtils.fetchWithTimeout(`./api/movie-hunt/instances?t=${_ts}`).catch(function() { return null; }),
                HuntarrUtils.fetchWithTimeout(`./api/tv-hunt/instances?t=${_ts}`).catch(function() { return null; })
            ]);

            if (settingsResp.ok) {
                const settings = await settingsResp.json();
                if (window.huntarrUI) {
                    window.huntarrUI.originalSettings = window.huntarrUI.originalSettings || {};
                    const appTypes = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
                    appTypes.forEach(function(at) {
                        if (settings[at]) {
                            window.huntarrUI.originalSettings[at] = window.huntarrUI.originalSettings[at] || {};
                            window.huntarrUI.originalSettings[at].instances = settings[at].instances || [];
                        }
                    });
                }
            }

            // Cache Movie Hunt instances separately (they come from a different API)
            if (movieHuntResp && movieHuntResp.ok) {
                const mhData = await movieHuntResp.json();
                window._movieHuntInstances = Array.isArray(mhData.instances) ? mhData.instances : [];
                console.debug('[Scheduler] Movie Hunt instances loaded:', window._movieHuntInstances.length);
            } else {
                window._movieHuntInstances = [];
            }

            // Cache TV Hunt instances separately (they come from a different API)
            if (tvHuntResp && tvHuntResp.ok) {
                const thData = await tvHuntResp.json();
                window._tvHuntInstances = Array.isArray(thData.instances) ? thData.instances : [];
                console.debug('[Scheduler] TV Hunt instances loaded:', window._tvHuntInstances.length);
            } else {
                window._tvHuntInstances = [];
            }

            // Trigger instance dropdown population based on current app selection
            populateInstanceDropdown();
            console.debug('[Scheduler] Instance dropdowns populated from API');
        } catch (err) {
            console.warn('[Scheduler] Could not fetch settings for instances', err);
            window._movieHuntInstances = window._movieHuntInstances || [];
            window._tvHuntInstances = window._tvHuntInstances || [];
            populateInstanceDropdown();
        }
    }

    function populateInstanceDropdown() {
        const appTypeSelect = document.getElementById('scheduleAppType');
        const instanceSelect = document.getElementById('scheduleInstance');
        if (!appTypeSelect || !instanceSelect) return;

        const appType = appTypeSelect.value;
        instanceSelect.innerHTML = '';

        if (appType === 'global') {
            instanceSelect.innerHTML = '<option value="all">All Instances</option>';
            instanceSelect.disabled = true;
            updateHiddenApp();
            return;
        }

        instanceSelect.disabled = false;

        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = 'All Instances';
        instanceSelect.appendChild(allOpt);

        // Movie Hunt uses a dedicated instance list (numeric IDs from DB)
        if (appType === 'movie_hunt') {
            var mhInstances = window._movieHuntInstances || [];
            mhInstances.forEach(function(inst) {
                if (!inst || typeof inst !== 'object') return;
                var opt = document.createElement('option');
                opt.value = String(inst.id);
                opt.textContent = inst.name || ('Instance ' + inst.id);
                instanceSelect.appendChild(opt);
            });
            updateHiddenApp();
            return;
        }

        // TV Hunt uses a dedicated instance list (numeric IDs from DB)
        if (appType === 'tv_hunt') {
            var thInstances = window._tvHuntInstances || [];
            thInstances.forEach(function(inst) {
                if (!inst || typeof inst !== 'object') return;
                var opt = document.createElement('option');
                opt.value = String(inst.id);
                opt.textContent = inst.name || ('Instance ' + inst.id);
                instanceSelect.appendChild(opt);
            });
            updateHiddenApp();
            return;
        }

        // Standard apps: get instances from settings cache
        const settings = (window.huntarrUI && window.huntarrUI.originalSettings) ? window.huntarrUI.originalSettings : {};
        const appSettings = settings[appType] || {};
        const instances = Array.isArray(appSettings.instances) ? appSettings.instances : [];

        instances.forEach(function(inst, idx) {
            if (!inst || typeof inst !== 'object') return;
            const opt = document.createElement('option');
            opt.value = inst.instance_id || String(idx);
            opt.textContent = inst.name || inst.instance_name || ('Instance ' + (idx + 1));
            instanceSelect.appendChild(opt);
        });

        updateHiddenApp();
    }

    function updateHiddenApp() {
        const appTypeSelect = document.getElementById('scheduleAppType');
        const instanceSelect = document.getElementById('scheduleInstance');
        const hiddenApp = document.getElementById('scheduleApp');
        if (!appTypeSelect || !instanceSelect || !hiddenApp) return;

        const appType = appTypeSelect.value;
        const instanceVal = instanceSelect.value;

        if (appType === 'global') {
            hiddenApp.value = 'global';
        } else if (instanceVal === 'all') {
            hiddenApp.value = appType + '::all';
        } else {
            hiddenApp.value = appType + '::' + instanceVal;
        }
    }

    // Wire up cascading dropdowns (backup for if inline script doesn't run)
    document.addEventListener('DOMContentLoaded', function() {
        const appTypeSelect = document.getElementById('scheduleAppType');
        const instanceSelect = document.getElementById('scheduleInstance');
        if (appTypeSelect) {
            appTypeSelect.removeEventListener('change', populateInstanceDropdown);
            appTypeSelect.addEventListener('change', populateInstanceDropdown);
        }
        if (instanceSelect) {
            instanceSelect.removeEventListener('change', updateHiddenApp);
            instanceSelect.addEventListener('change', updateHiddenApp);
        }
    });

    // ---------------------------------------------------------------
    // Load / Save schedules
    // ---------------------------------------------------------------

    function loadSchedules() {
        HuntarrUtils.fetchWithTimeout('./api/scheduler/load')
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to load schedules');
                return response.json();
            })
            .then(function(data) {
                Object.keys(schedules).forEach(function(key) {
                    if (Array.isArray(data[key])) {
                        schedules[key] = data[key].map(function(s) {
                            var timeObj = s.time;
                            if (typeof s.time === 'string') {
                                var parts = s.time.split(':').map(Number);
                                timeObj = { hour: parts[0], minute: parts[1] || 0 };
                            } else if (!s.time) {
                                timeObj = { hour: 0, minute: 0 };
                            }
                            return {
                                id: s.id || String(Date.now() + Math.random() * 1000),
                                time: timeObj,
                                days: Array.isArray(s.days) ? s.days : [],
                                action: s.action || 'enable',
                                app: s.app || 'global',
                                appType: s.appType || key,
                                enabled: s.enabled !== false
                            };
                        });
                    } else {
                        schedules[key] = [];
                    }
                });
                renderSchedules();
            })
            .catch(function(error) {
                console.error('[Scheduler] Error loading schedules:', error);
                Object.keys(schedules).forEach(function(key) { schedules[key] = []; });
                renderSchedules();
            });
    }

    function saveSchedules() {
        var payload = {};
        Object.keys(schedules).forEach(function(key) { payload[key] = []; });

        Object.entries(schedules).forEach(function(entry) {
            var appType = entry[0], list = entry[1];
            if (!Array.isArray(list)) return;
            payload[appType] = list.map(function(s) {
                var daysArr = [];
                if (Array.isArray(s.days)) {
                    daysArr = s.days;
                } else if (s.days && typeof s.days === 'object') {
                    Object.entries(s.days).forEach(function(d) {
                        if (d[1] === true) daysArr.push(d[0]);
                    });
                }
                return {
                    id: s.id,
                    time: s.time,
                    days: daysArr,
                    action: s.action,
                    app: s.app || 'global',
                    enabled: s.enabled !== false,
                    appType: appType
                };
            });
        });

        HuntarrUtils.fetchWithTimeout('./api/scheduler/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Schedule saved successfully', 'success');
                }
            } else {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to save schedule', 'error');
                }
            }
        })
        .catch(function(err) {
            console.error('[Scheduler] Save error:', err);
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('Failed to save schedule', 'error');
            }
        });
    }

    // ---------------------------------------------------------------
    // Add / Delete
    // ---------------------------------------------------------------

    function addSchedule() {
        var hour = parseInt(document.getElementById('scheduleHour').value);
        var minute = parseInt(document.getElementById('scheduleMinute').value);
        var action = document.getElementById('scheduleAction').value;

        var dayIds = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
        var daysArr = [];
        dayIds.forEach(function(d) {
            if (document.getElementById('day-' + d).checked) daysArr.push(d);
        });

        if (isNaN(hour) || isNaN(minute)) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('Please enter a valid time.', 'error');
            } else { alert('Please enter a valid time.'); }
            return;
        }
        if (daysArr.length === 0) return;

        // Read the combined app value from the hidden select
        var app = document.getElementById('scheduleApp').value || 'global';

        // Determine which appType bucket to store in
        var appType = 'global';
        if (app !== 'global') {
            var colonIdx = app.indexOf('::');
            var dashIdx = app.indexOf('-');
            if (colonIdx > 0) {
                appType = app.substring(0, colonIdx);
            } else if (dashIdx > 0) {
                appType = app.substring(0, dashIdx);
            }
        }

        if (!schedules[appType]) schedules[appType] = [];

        schedules[appType].push({
            id: Date.now().toString(),
            time: { hour: hour, minute: minute },
            days: daysArr,
            action: action,
            app: app,
            enabled: true
        });

        saveSchedules();
        renderSchedules();
    }

    function deleteSchedule(scheduleId, appType) {
        if (!schedules[appType]) return;
        var idx = schedules[appType].findIndex(function(s) { return s.id === scheduleId; });
        if (idx === -1) return;
        schedules[appType].splice(idx, 1);
        saveSchedules();
        renderSchedules();
    }

    // ---------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------

    function renderSchedules() {
        var container = document.getElementById('schedulesContainer');
        var emptyMsg = document.getElementById('noSchedulesMessage');
        if (!container || !emptyMsg) return;

        container.innerHTML = '';

        var all = [];
        Object.entries(schedules).forEach(function(entry) {
            var appType = entry[0], list = entry[1];
            if (!Array.isArray(list)) return;
            list.forEach(function(s) {
                all.push(Object.assign({}, s, { appType: s.appType || appType }));
            });
        });

        if (all.length === 0) {
            container.style.display = 'none';
            emptyMsg.style.display = 'block';
            return;
        }

        container.style.display = 'block';
        emptyMsg.style.display = 'none';

        all.sort(function(a, b) {
            var at = (a.time.hour || 0) * 60 + (a.time.minute || 0);
            var bt = (b.time.hour || 0) * 60 + (b.time.minute || 0);
            return at - bt;
        });

        all.forEach(function(s) {
            var el = document.createElement('div');
            el.className = 'schedule-item';

            var timeStr = String(s.time.hour).padStart(2, '0') + ':' + String(s.time.minute).padStart(2, '0');

            // Days
            var daysText = 'Daily';
            if (Array.isArray(s.days)) {
                if (s.days.length === 7) { daysText = 'Daily'; }
                else if (s.days.length === 0) { daysText = 'None'; }
                else { daysText = s.days.map(function(d) { return d.substring(0,1).toUpperCase() + d.substring(1,3); }).join(', '); }
            }

            // Action
            var actionText = s.action || '';
            var actionClass = '';
            if (actionText === 'resume' || actionText === 'enable') { actionText = 'Enable'; actionClass = 'action-enable'; }
            else if (actionText === 'pause' || actionText === 'disable') { actionText = 'Disable'; actionClass = 'action-disable'; }
            else if (actionText.startsWith('api-')) { actionText = 'API Limit: ' + actionText.split('-')[1]; }

            // App / Instance display
            var appText = formatAppDisplay(s.app);

            el.innerHTML =
                '<div class="schedule-item-time">' + timeStr + '</div>' +
                '<div class="schedule-item-days">' + daysText + '</div>' +
                '<div class="schedule-item-action ' + actionClass + '">' + actionText + '</div>' +
                '<div class="schedule-item-app">' + appText + '</div>' +
                '<div class="schedule-item-actions">' +
                    '<button class="delete-schedule" data-id="' + s.id + '" data-app-type="' + s.appType + '"><i class="fas fa-trash"></i></button>' +
                '</div>';

            container.appendChild(el);
        });
    }

    function formatAppDisplay(appValue) {
        if (!appValue || appValue === 'global') return 'All Apps (Global)';

        var base, instanceId;

        // New format: app::id
        if (appValue.indexOf('::') > 0) {
            var parts = appValue.split('::');
            base = parts[0];
            instanceId = parts[1];
        }
        // Legacy format: app-id (but NOT movie_hunt/tv_hunt which use underscores)
        else if (appValue.indexOf('-') > 0 && appValue.indexOf('movie_hunt') !== 0 && appValue.indexOf('tv_hunt') !== 0) {
            var dashParts = appValue.split('-', 2);
            base = dashParts[0];
            instanceId = dashParts[1];
        } else {
            return formatAppLabel(appValue);
        }

        var label = formatAppLabel(base);

        if (instanceId === 'all') return 'All ' + label + ' Instances';

        // Movie Hunt: resolve from dedicated instance cache
        if (base === 'movie_hunt') {
            var mhInstances = window._movieHuntInstances || [];
            for (var m = 0; m < mhInstances.length; m++) {
                if (String(mhInstances[m].id) === instanceId) {
                    return label + ' — ' + (mhInstances[m].name || 'Instance ' + mhInstances[m].id);
                }
            }
            return label + ' — Instance ' + instanceId;
        }

        // TV Hunt: resolve from dedicated instance cache
        if (base === 'tv_hunt') {
            var thInstances = window._tvHuntInstances || [];
            for (var t = 0; t < thInstances.length; t++) {
                if (String(thInstances[t].id) === instanceId) {
                    return label + ' — ' + (thInstances[t].name || 'Instance ' + thInstances[t].id);
                }
            }
            return label + ' — Instance ' + instanceId;
        }

        // Standard apps: try to resolve instance name from settings
        var settings = (window.huntarrUI && window.huntarrUI.originalSettings) ? window.huntarrUI.originalSettings : {};
        var instances = (settings[base] && settings[base].instances) ? settings[base].instances : [];

        // Search by instance_id first
        for (var i = 0; i < instances.length; i++) {
            if (instances[i] && instances[i].instance_id === instanceId) {
                return label + ' — ' + (instances[i].name || instances[i].instance_name || 'Instance ' + (i+1));
            }
        }

        // Fallback: try as numeric index (legacy)
        if (/^\d+$/.test(instanceId)) {
            var idx = parseInt(instanceId, 10);
            if (instances[idx]) {
                return label + ' — ' + (instances[idx].name || instances[idx].instance_name || 'Instance ' + (idx+1));
            }
        }

        return label + ' — Instance ' + instanceId;
    }

    function formatAppLabel(appName) {
        if (appName === 'movie_hunt') return 'Movie Hunt';
        if (appName === 'tv_hunt') return 'TV Hunt';
        return capitalizeFirst(appName);
    }

    // ---------------------------------------------------------------
    // Timezone
    // ---------------------------------------------------------------

    var serverTimeInterval = null;

    function loadServerTimezone() {
        HuntarrUtils.fetchWithTimeout('./api/settings')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var tz = (data.general && (data.general.effective_timezone || data.general.timezone)) || 'UTC';

                if (serverTimeInterval) clearInterval(serverTimeInterval);

                var tzSpan = document.getElementById('serverTimezone');
                if (tzSpan) tzSpan.textContent = tz.replace(/_/g, ' ');

                updateServerTime(tz);
                updateTimeInputsWithServerTime(tz);

                serverTimeInterval = setInterval(function() { updateServerTime(tz); }, 60000);
            })
            .catch(function() {
                updateServerTime('UTC');
            });
    }

    function updateServerTime(tz) {
        var el = document.getElementById('serverCurrentTime');
        if (!el) return;
        try {
            el.textContent = new Date().toLocaleTimeString('en-US', {
                timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { el.textContent = '--:--'; }
    }

    function updateTimeInputsWithServerTime(tz) {
        var h = document.getElementById('scheduleHour');
        var m = document.getElementById('scheduleMinute');
        if (!h || !m) return;
        try {
            var now = new Date();
            var st = new Date(now.toLocaleString('en-US', { timeZone: tz }));
            h.value = st.getHours();
            m.value = Math.floor(st.getMinutes() / 5) * 5;
        } catch (e) { /* ignore */ }
    }

    function initializeTimeInputs() {
        var now = new Date();
        var h = document.getElementById('scheduleHour');
        var m = document.getElementById('scheduleMinute');
        if (h) h.value = now.getHours();
        if (m) m.value = Math.floor(now.getMinutes() / 5) * 5;
    }

    // ---------------------------------------------------------------
    // Global exports
    // ---------------------------------------------------------------

    window.refreshSchedulingTimezone = loadServerTimezone;
    window.refreshSchedulingInstances = loadAppInstances;

    // Auto-refresh scheduling instances when any instance changes anywhere in the app
    document.addEventListener('huntarr:instances-changed', function() {
        loadAppInstances();
    });

})();
