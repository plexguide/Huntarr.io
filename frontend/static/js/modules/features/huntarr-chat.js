/**
 * Huntarr Chat — lightweight floating chat widget
 * Polls for new messages every 8s when open, 30s when closed.
 * Owner gets moderator controls (delete any message, clear all).
 */
window.HuntarrChat = (function() {
    'use strict';

    let _panel = null;
    let _fab = null;
    let _messagesEl = null;
    let _inputEl = null;
    let _isOpen = false;
    let _user = null;       // { username, role, chat_disabled }
    let _messages = [];
    let _pollTimer = null;
    let _lastMsgId = 0;
    let _unreadCount = 0;
    let _badgeEl = null;
    let _initialized = false;
    let _chatDisabled = false;

    const POLL_OPEN = 8000;
    const POLL_CLOSED = 30000;

    // ── Init ──────────────────────────────────────────────────
    function init() {
        if (_initialized) return;
        _initialized = true;
        // Don't build DOM yet — wait until we confirm auth
        _checkAuthAndInit();
    }

    function _checkAuthAndInit() {
        fetch('./api/chat')
            .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function(data) {
                _user = data.user;
                _chatDisabled = data.user && data.user.chat_disabled;
                _messages = data.messages || [];
                if (_messages.length) _lastMsgId = _messages[_messages.length - 1].id;
                // User is authenticated — now build the UI
                // If chat is disabled for this user, don't show anything
                if (_chatDisabled) return;
                _buildDOM();
                // Show clear button for owner
                var clearBtn = document.getElementById('hchat-clear-btn');
                if (clearBtn) clearBtn.style.display = _user.role === 'owner' ? '' : 'none';
                _renderMessages();
                _startPolling();
            })
            .catch(function() {
                // Not authenticated (login page) — do nothing, no FAB
            });
    }

    // ── Build DOM ─────────────────────────────────────────────
    function _buildDOM() {
        // FAB
        _fab = document.createElement('button');
        _fab.className = 'hchat-fab';
        _fab.setAttribute('aria-label', 'Open chat');
        _fab.innerHTML = '<i class="fas fa-comments"></i><span class="hchat-badge" style="display:none;"></span>';
        _fab.addEventListener('click', _toggle);
        document.body.appendChild(_fab);
        _badgeEl = _fab.querySelector('.hchat-badge');

        // Panel
        _panel = document.createElement('div');
        _panel.className = 'hchat-panel';
        _panel.innerHTML =
            '<div class="hchat-header">' +
                '<div class="hchat-header-left">' +
                    '<i class="fas fa-comments"></i>' +
                    '<span>Chat</span>' +
                '</div>' +
                '<div class="hchat-header-actions">' +
                    '<button class="hchat-header-btn danger" id="hchat-clear-btn" title="Clear all messages" style="display:none;">' +
                        '<i class="fas fa-trash-alt"></i>' +
                    '</button>' +
                    '<button class="hchat-header-btn" id="hchat-close-btn" title="Close">' +
                        '<i class="fas fa-times"></i>' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div class="hchat-messages" id="hchat-messages"></div>' +
            '<div class="hchat-input-area">' +
                '<textarea class="hchat-input" id="hchat-input" placeholder="Type a message..." rows="1" maxlength="500"></textarea>' +
                '<button class="hchat-send" id="hchat-send-btn" disabled aria-label="Send">' +
                    '<i class="fas fa-paper-plane"></i>' +
                '</button>' +
            '</div>';
        document.body.appendChild(_panel);

        _messagesEl = document.getElementById('hchat-messages');
        _inputEl = document.getElementById('hchat-input');

        document.getElementById('hchat-close-btn').addEventListener('click', _toggle);
        document.getElementById('hchat-send-btn').addEventListener('click', _sendMessage);
        document.getElementById('hchat-clear-btn').addEventListener('click', _clearAll);

        _inputEl.addEventListener('input', function() {
            document.getElementById('hchat-send-btn').disabled = !_inputEl.value.trim();
            // Auto-resize
            _inputEl.style.height = 'auto';
            _inputEl.style.height = Math.min(_inputEl.scrollHeight, 80) + 'px';
        });
        _inputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (_inputEl.value.trim()) _sendMessage();
            }
        });
    }

    // ── Toggle ────────────────────────────────────────────────
    function _toggle() {
        _isOpen = !_isOpen;
        _panel.classList.toggle('open', _isOpen);
        _fab.setAttribute('aria-label', _isOpen ? 'Close chat' : 'Open chat');
        if (_isOpen) {
            _unreadCount = 0;
            _updateBadge();
            _scrollToBottom();
            _inputEl.focus();
            _restartPolling();
        } else {
            _restartPolling();
        }
    }

    // ── Load Messages (replaced by _checkAuthAndInit on first load) ──

    // ── Poll for new messages ─────────────────────────────────
    function _startPolling() {
        _pollTimer = setInterval(_pollNew, _isOpen ? POLL_OPEN : POLL_CLOSED);
    }
    function _restartPolling() {
        clearInterval(_pollTimer);
        _startPolling();
    }
    function _pollNew() {
        fetch('./api/chat')
            .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function(data) {
                _user = data.user;
                var msgs = data.messages || [];
                if (!msgs.length) {
                    if (_messages.length) { _messages = []; _lastMsgId = 0; _renderMessages(); }
                    return;
                }
                var newLastId = msgs[msgs.length - 1].id;
                if (newLastId !== _lastMsgId || msgs.length !== _messages.length) {
                    var hadMessages = _messages.length;
                    // Count how many new messages since last check
                    var newCount = 0;
                    if (hadMessages && newLastId > _lastMsgId) {
                        for (var i = msgs.length - 1; i >= 0; i--) {
                            if (msgs[i].id > _lastMsgId) newCount++;
                            else break;
                        }
                    }
                    _messages = msgs;
                    _lastMsgId = newLastId;
                    _renderMessages();
                    if (!_isOpen && newCount > 0) {
                        _unreadCount += newCount;
                        _updateBadge();
                    }
                    if (_isOpen) _scrollToBottom();
                }
            })
            .catch(function() {});
    }

    // ── Render ────────────────────────────────────────────────
    function _renderMessages() {
        if (!_messagesEl) return;
        if (!_messages.length) {
            _messagesEl.innerHTML =
                '<div class="hchat-empty">' +
                    '<i class="fas fa-comments"></i>' +
                    '<span>No messages yet. Say hi!</span>' +
                '</div>';
            return;
        }
        var html = '';
        var lastDate = '';
        for (var i = 0; i < _messages.length; i++) {
            var m = _messages[i];
            var isSelf = _user && m.username === _user.username;
            var msgDate = _formatDate(m.created_at);
            if (msgDate !== lastDate) {
                html += '<div class="hchat-date-sep"><span>' + msgDate + '</span></div>';
                lastDate = msgDate;
            }
            var canDelete = _user && (_user.role === 'owner' || isSelf);
            html += '<div class="hchat-msg ' + (isSelf ? 'self' : 'other') + '" data-id="' + m.id + '">';
            html += '<div class="hchat-msg-meta">';
            html += '<span class="hchat-msg-author">' + _escHtml(m.username) + '</span>';
            html += '<span class="hchat-msg-role ' + m.role + '">' + m.role + '</span>';
            html += '<span class="hchat-msg-time">' + _formatTime(m.created_at) + '</span>';
            html += '</div>';
            html += '<div class="hchat-msg-row">';
            if (canDelete && isSelf) {
                html += '<button class="hchat-msg-delete" data-id="' + m.id + '" title="Delete" aria-label="Delete message"><i class="fas fa-trash-alt"></i></button>';
            }
            html += '<div class="hchat-msg-bubble">' + _escHtml(_unescHtml(m.message)) + '</div>';
            if (canDelete && !isSelf) {
                html += '<button class="hchat-msg-delete" data-id="' + m.id + '" title="Delete" aria-label="Delete message"><i class="fas fa-trash-alt"></i></button>';
            }
            html += '</div></div>';
        }
        _messagesEl.innerHTML = html;
        // Attach delete handlers
        _messagesEl.querySelectorAll('.hchat-msg-delete').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                _deleteMessage(parseInt(btn.getAttribute('data-id')));
            });
        });
        _scrollToBottom();
    }

    // ── Send ──────────────────────────────────────────────────
    function _sendMessage() {
        var text = _inputEl.value.trim();
        if (!text) return;
        var sendBtn = document.getElementById('hchat-send-btn');
        sendBtn.disabled = true;
        _inputEl.value = '';
        _inputEl.style.height = 'auto';

        fetch('./api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success && data.message) {
                _messages.push(data.message);
                _lastMsgId = data.message.id;
                _renderMessages();
            }
        })
        .catch(function() {})
        .finally(function() { sendBtn.disabled = !_inputEl.value.trim(); });
    }

    // ── Delete ────────────────────────────────────────────────
    function _deleteMessage(id) {
        fetch('./api/chat/' + id, { method: 'DELETE' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _messages = _messages.filter(function(m) { return m.id !== id; });
                    _renderMessages();
                }
            })
            .catch(function() {});
    }

    // ── Clear All ─────────────────────────────────────────────
    function _clearAll() {
        if (!window.HuntarrConfirm) {
            if (!confirm('Clear all chat messages?')) return;
            _doClear();
        } else {
            window.HuntarrConfirm.show({
                title: 'Clear Chat',
                message: 'Delete all chat messages? This cannot be undone.',
                confirmText: 'Clear All',
                confirmClass: 'danger',
                onConfirm: _doClear
            });
        }
    }
    function _doClear() {
        fetch('./api/chat/clear', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _messages = [];
                    _lastMsgId = 0;
                    _renderMessages();
                }
            })
            .catch(function() {});
    }

    // ── Helpers ───────────────────────────────────────────────
    function _updateBadge() {
        if (!_badgeEl) return;
        if (_unreadCount > 0) {
            _badgeEl.textContent = _unreadCount > 99 ? '99+' : _unreadCount;
            _badgeEl.style.display = '';
        } else {
            _badgeEl.style.display = 'none';
        }
    }

    function _scrollToBottom() {
        if (_messagesEl) {
            requestAnimationFrame(function() {
                _messagesEl.scrollTop = _messagesEl.scrollHeight;
            });
        }
    }
    function _formatTime(ts) {
        if (!ts) return '';
        try {
            var d = new Date(ts.replace(' ', 'T') + 'Z');
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch(e) { return ''; }
    }
    function _formatDate(ts) {
        if (!ts) return '';
        try {
            var d = new Date(ts.replace(' ', 'T') + 'Z');
            var now = new Date();
            if (d.toDateString() === now.toDateString()) return 'Today';
            var yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } catch(e) { return ''; }
    }
    function _escHtml(s) {
        var div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }
    // Unescape HTML entities that were stored by old backend html.escape()
    function _unescHtml(s) {
        if (!s || s.indexOf('&') === -1) return s;
        var div = document.createElement('div');
        div.innerHTML = s;
        return div.textContent || div.innerText || s;
    }

    return { init: init };
})();

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Small delay to let auth settle
    setTimeout(function() { window.HuntarrChat.init(); }, 1500);
});
