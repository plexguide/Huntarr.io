/**
 * Global confirm modal - purple/blue style. Replaces native confirm() for deletes.
 * Usage: HuntarrConfirm.show({ title: 'Delete ...', message: '...', confirmLabel: 'Delete', onConfirm: function() { ... } });
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';

    function ensureModalInBody() {
        var modal = document.getElementById('huntarr-confirm-modal');
        if (modal && modal.parentNode !== document.body) {
            document.body.appendChild(modal);
        }
        return modal;
    }

    function closeModal() {
        var modal = document.getElementById('huntarr-confirm-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('huntarr-confirm-modal-open');
    }

    function initOnce() {
        var modal = document.getElementById('huntarr-confirm-modal');
        if (!modal || modal._huntarrConfirmInit) return;
        modal._huntarrConfirmInit = true;

        var backdrop = document.getElementById('huntarr-confirm-modal-backdrop');
        var closeBtn = document.getElementById('huntarr-confirm-modal-close');
        var cancelBtn = document.getElementById('huntarr-confirm-modal-cancel');
        var confirmBtn = document.getElementById('huntarr-confirm-modal-confirm');

        function handleCancel() {
            var fn = modal._onCancel;
            if (typeof fn === 'function') fn();
            closeModal();
        }
        if (backdrop) backdrop.onclick = handleCancel;
        if (closeBtn) closeBtn.onclick = handleCancel;
        if (cancelBtn) cancelBtn.onclick = handleCancel;

        if (confirmBtn) {
            confirmBtn.onclick = function() {
                var fn = modal._onConfirm;
                if (typeof fn === 'function') {
                    confirmBtn.disabled = true;
                    try {
                        fn();
                    } finally {
                        confirmBtn.disabled = false;
                    }
                }
                closeModal();
            };
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && modal.style.display === 'flex') handleCancel();
        });
    }

    window.HuntarrConfirm = {
        show: function(options) {
            var opts = options || {};
            var title = opts.title != null ? String(opts.title) : 'Confirm';
            var message = opts.message != null ? String(opts.message) : '';
            var confirmLabel = opts.confirmLabel != null ? String(opts.confirmLabel) : 'OK';
            var cancelLabel = opts.cancelLabel != null ? String(opts.cancelLabel) : null;
            var onConfirm = typeof opts.onConfirm === 'function' ? opts.onConfirm : function() {};
            var onCancel = typeof opts.onCancel === 'function' ? opts.onCancel : null;

            var modal = ensureModalInBody();
            if (!modal) return;

            initOnce();

            var titleEl = document.getElementById('huntarr-confirm-modal-title');
            var messageEl = document.getElementById('huntarr-confirm-modal-message');
            var confirmBtn = document.getElementById('huntarr-confirm-modal-confirm');
            var cancelBtn = document.getElementById('huntarr-confirm-modal-cancel');
            if (titleEl) titleEl.textContent = title;
            if (messageEl) messageEl.textContent = message;
            if (confirmBtn) {
                confirmBtn.textContent = confirmLabel;
                confirmBtn.innerHTML = confirmLabel;
            }
            if (cancelBtn && cancelLabel) {
                cancelBtn.textContent = cancelLabel;
                cancelBtn.innerHTML = cancelLabel;
            }
            modal._onConfirm = onConfirm;
            modal._onCancel = onCancel;

            modal.style.display = 'flex';
            document.body.classList.add('huntarr-confirm-modal-open');
        }
    };
})();
