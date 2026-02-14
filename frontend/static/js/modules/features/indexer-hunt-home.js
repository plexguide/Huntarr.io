/**
 * Indexer Hunt — Home Page Card
 * Shows indexer list + aggregate statistics on the Home dashboard.
 * Only visible when at least one Indexer Hunt indexer is configured.
 * Mirrors the Prowlarr home card design exactly.
 */
window.HuntarrIndexerHuntHome = {
    _pollInterval: null,

    /* ── Bootstrap ─────────────────────────────────────────────── */
    setup: function() {
        this.load();

        // Refresh every 5 minutes (same cadence as Prowlarr stats)
        if (!this._pollInterval) {
            var self = this;
            this._pollInterval = setInterval(function() {
                if (window.huntarrUI && window.huntarrUI.currentSection === 'home') {
                    self.load();
                }
            }, 5 * 60 * 1000);
        }
    },

    /* ── Main loader ───────────────────────────────────────────── */
    load: function() {
        var card = document.getElementById('indexerHuntStatusCard');
        if (!card) return;

        var self = this;

        // 1. Fetch indexers list — also tells us whether the card should show
        HuntarrUtils.fetchWithTimeout('./api/indexer-hunt/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var indexers = data.indexers || [];
                if (indexers.length === 0) {
                    card.style.display = 'none';
                    return;
                }

                card.style.display = 'block';

                // Connection badge
                var badge = document.getElementById('ihHomeConnectionStatus');
                if (badge) {
                    var enabledCount = indexers.filter(function(i) { return i.enabled !== false; }).length;
                    badge.textContent = '🟢 ' + enabledCount + ' Indexer' + (enabledCount !== 1 ? 's' : '') + ' Active';
                    badge.className = 'status-badge connected';
                }

                // Render indexer list (left sub-card)
                self._renderIndexerList(indexers);

                // 2. Fetch aggregate stats (right sub-card)
                self._loadStats();
            })
            .catch(function() {
                card.style.display = 'none';
            });
    },

    /* ── Left sub-card: indexer list ───────────────────────────── */
    _renderIndexerList: function(indexers) {
        var list = document.getElementById('ih-home-indexers-list');
        if (!list) return;

        if (!indexers || indexers.length === 0) {
            list.innerHTML = '<div class="loading-text">No indexers configured</div>';
            return;
        }

        // Sort alphabetically
        indexers.sort(function(a, b) {
            var na = (a.name || '').toLowerCase();
            var nb = (b.name || '').toLowerCase();
            return na < nb ? -1 : na > nb ? 1 : 0;
        });

        var html = indexers.map(function(idx) {
            var enabled = idx.enabled !== false;
            var statusClass = enabled ? 'active' : 'failed';
            var statusText  = enabled ? 'Active' : 'Disabled';
            var displayName = (idx.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            return '<div class="indexer-item">' +
                '<span class="indexer-name">' + displayName + '</span>' +
                '<span class="indexer-status ' + statusClass + '">' + statusText + '</span>' +
                '</div>';
        }).join('');

        list.innerHTML = html;
    },

    /* ── Right sub-card: aggregate stats ──────────────────────── */
    _loadStats: function() {
        var content = document.getElementById('ih-home-statistics-content');
        if (!content) return;

        var fmt = function(n) {
            var v = Number(n || 0);
            return Number.isFinite(v) ? String(Math.round(v)) : '0';
        };

        HuntarrUtils.fetchWithTimeout('./api/indexer-hunt/stats')
            .then(function(r) { return r.json(); })
            .then(function(stats) {
                var queries    = fmt(stats.total_queries);
                var grabs      = fmt(stats.total_grabs);
                var failures   = fmt(stats.total_failures);
                var avgMs      = Number(stats.avg_response_ms || 0);
                var failRate   = Number(stats.failure_rate || 0);

                content.innerHTML =
                    '<div class="stat-card">' +
                        '<div class="stat-label">TOTAL QUERIES</div>' +
                        '<div class="stat-value success">' + queries + '</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">TOTAL GRABS</div>' +
                        '<div class="stat-value success">' + grabs + '</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">AVG RESPONSE</div>' +
                        '<div class="stat-value success">' + (avgMs > 0 ? avgMs.toFixed(0) + 'ms' : 'N/A') + '</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">FAILURE RATE</div>' +
                        '<div class="stat-value' + (failRate > 10 ? ' error' : ' success') + '">' + failRate.toFixed(1) + '%</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">FAILURES</div>' +
                        '<div class="stat-value error">' + failures + '</div>' +
                    '</div>';
            })
            .catch(function() {
                content.innerHTML = '<div class="loading-text" style="color: #ef4444;">Failed to load stats</div>';
            });
    }
};
