/**
 * Global confirm modal - purple/blue style. Replaces native confirm() for deletes & unsaved-changes.
 * Usage:
 *   HuntarrConfirm.show({
 *       title: 'Delete ...',
 *       message: '...',
 *       confirmLabel: 'Delete',
 *       cancelLabel: 'Cancel',      // optional — relabels the cancel button
 *       onConfirm: function() { … },
 *       onCancel:  function() { … } // optional — called when cancel / X / backdrop / Escape
 *   });
 */
(function() {
    'use strict';

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

    window.HuntarrConfirm = {
        show: function(options) {
            var opts = options || {};
            var title        = opts.title != null ? String(opts.title) : 'Confirm';
            var message      = opts.message != null ? String(opts.message) : '';
            var confirmLabel = opts.confirmLabel != null ? String(opts.confirmLabel) : 'OK';
            var cancelLabel  = opts.cancelLabel != null ? String(opts.cancelLabel) : 'Cancel';
            var onConfirm    = typeof opts.onConfirm === 'function' ? opts.onConfirm : function() {};
            var onCancel     = typeof opts.onCancel  === 'function' ? opts.onCancel  : function() {};
            var extraButton  = opts.extraButton || null;

            var modal = ensureModalInBody();
            if (!modal) return;

            // --- populate text ------------------------------------------------
            var titleEl    = document.getElementById('huntarr-confirm-modal-title');
            var messageEl  = document.getElementById('huntarr-confirm-modal-message');
            var confirmBtn = document.getElementById('huntarr-confirm-modal-confirm');
            var cancelBtn  = document.getElementById('huntarr-confirm-modal-cancel');
            var extraBtn   = document.getElementById('huntarr-confirm-modal-extra');

            if (titleEl)    titleEl.textContent = title;
            if (messageEl)  messageEl.textContent = message;
            if (confirmBtn) confirmBtn.textContent = confirmLabel;
            if (cancelBtn)  cancelBtn.textContent  = cancelLabel;

            // --- extra button (optional) --------------------------------------
            if (extraBtn) {
                if (extraButton && extraButton.label) {
                    extraBtn.textContent = extraButton.label;
                    extraBtn.style.display = '';
                    extraBtn.className = 'huntarr-confirm-modal-extra';
                    if (extraButton.className) extraBtn.classList.add(extraButton.className);
                } else {
                    extraBtn.style.display = 'none';
                }
            }

            // --- bind handlers fresh every time -------------------------------
            var handled = false;

            function doCancel() {
                if (handled) return;
                handled = true;
                closeModal();
                onCancel();
            }

            function doConfirm() {
                if (handled) return;
                handled = true;
                closeModal();
                onConfirm();
            }

            function doExtra() {
                if (handled) return;
                handled = true;
                closeModal();
                if (extraButton && typeof extraButton.onClick === 'function') extraButton.onClick();
            }

            var backdrop = document.getElementById('huntarr-confirm-modal-backdrop');
            var closeBtn = document.getElementById('huntarr-confirm-modal-close');

            if (backdrop)   backdrop.onclick = doCancel;
            if (closeBtn)   closeBtn.onclick = doCancel;
            if (cancelBtn)  cancelBtn.onclick = doCancel;
            if (confirmBtn) confirmBtn.onclick = doConfirm;
            if (extraBtn)   extraBtn.onclick = doExtra;

            // Escape key
            function onKeyDown(e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') {
                    document.removeEventListener('keydown', onKeyDown);
                    doCancel();
                }
            }
            document.addEventListener('keydown', onKeyDown);

            // --- show ---------------------------------------------------------
            modal.style.display = 'flex';
            document.body.classList.add('huntarr-confirm-modal-open');
        }
    };
})();
