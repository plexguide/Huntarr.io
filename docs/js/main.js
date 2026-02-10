/* ================================================================
   Huntarr Documentation — Main JS
   Sidebar toggle, collapsible groups, active page, copy buttons,
   scroll-to-top, smooth anchor scrolling.
   ================================================================ */
(function () {
    'use strict';

    /* --- DOM refs --- */
    var sidebar     = document.querySelector('.docs-sidebar');
    var backdrop    = document.querySelector('.docs-sidebar-backdrop');
    var hamburger   = document.querySelector('.mob-hamburger');
    var backToTop   = document.querySelector('.back-to-top');

    /* ===============================================================
       MOBILE SIDEBAR TOGGLE
       =============================================================== */
    function openSidebar()  {
        if (!sidebar) return;
        sidebar.classList.add('open');
        if (backdrop) backdrop.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeSidebar() {
        if (!sidebar) return;
        sidebar.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        document.body.style.overflow = '';
    }
    if (hamburger) hamburger.addEventListener('click', openSidebar);
    if (backdrop)  backdrop.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeSidebar();
    });

    /* Close sidebar when a nav link is clicked (mobile) */
    document.querySelectorAll('.nav-group-items a').forEach(function (link) {
        link.addEventListener('click', function () {
            if (window.innerWidth <= 768) closeSidebar();
        });
    });

    /* ===============================================================
       COLLAPSIBLE NAV GROUPS
       =============================================================== */
    document.querySelectorAll('.nav-group-title').forEach(function (title) {
        var group = title.parentElement;
        var items = group.querySelector('.nav-group-items');
        if (!items) return;

        /* Set initial max-height so the CSS transition works */
        if (!group.classList.contains('collapsed')) {
            items.style.maxHeight = items.scrollHeight + 'px';
        }

        title.addEventListener('click', function () {
            if (group.classList.contains('collapsed')) {
                group.classList.remove('collapsed');
                items.style.maxHeight = items.scrollHeight + 'px';
            } else {
                items.style.maxHeight = items.scrollHeight + 'px';
                /* Force reflow before collapsing */
                void items.offsetHeight;
                group.classList.add('collapsed');
                items.style.maxHeight = '0px';
            }
        });
    });

    /* ===============================================================
       ACTIVE PAGE HIGHLIGHTING
       =============================================================== */
    (function highlightActive() {
        var path = window.location.pathname;
        /* Normalise: strip trailing index.html */
        path = path.replace(/index\.html$/, '');
        var links = document.querySelectorAll('.nav-group-items a');
        links.forEach(function (a) {
            var href = a.getAttribute('href');
            if (!href) return;
            /* Resolve relative to absolute for comparison */
            var resolved = new URL(href, window.location.href).pathname.replace(/index\.html$/, '');
            if (resolved === path) {
                a.classList.add('active');
                /* Make sure parent group is expanded */
                var group = a.closest('.nav-group');
                if (group && group.classList.contains('collapsed')) {
                    group.classList.remove('collapsed');
                    var items = group.querySelector('.nav-group-items');
                    if (items) items.style.maxHeight = items.scrollHeight + 'px';
                }
            }
        });
    })();

    /* ===============================================================
       COPY BUTTONS ON <pre> BLOCKS
       =============================================================== */
    document.querySelectorAll('pre').forEach(function (pre) {
        var btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = 'Copy';
        btn.addEventListener('click', function () {
            var code = pre.querySelector('code');
            var text = (code || pre).textContent;
            navigator.clipboard.writeText(text).then(function () {
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(function () {
                    btn.textContent = 'Copy';
                    btn.classList.remove('copied');
                }, 2000);
            }).catch(function () {
                /* Fallback for non-secure contexts */
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); btn.textContent = 'Copied!'; btn.classList.add('copied'); }
                catch(e) { btn.textContent = 'Failed'; }
                document.body.removeChild(ta);
                setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
            });
        });
        pre.style.position = 'relative';
        pre.appendChild(btn);
    });

    /* ===============================================================
       SCROLL TO TOP
       =============================================================== */
    if (backToTop) {
        window.addEventListener('scroll', function () {
            backToTop.classList.toggle('visible', window.scrollY > 300);
        });
        backToTop.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    /* ===============================================================
       SMOOTH ANCHOR SCROLLING
       =============================================================== */
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
        a.addEventListener('click', function (e) {
            var target = document.querySelector(this.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                history.replaceState(null, '', this.getAttribute('href'));
            }
        });
    });

})();
