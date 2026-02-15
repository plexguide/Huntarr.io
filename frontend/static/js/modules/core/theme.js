/**
 * Theme Module
 * Handles logo persistence. Huntarr is always dark — no light mode.
 */

window.HuntarrTheme = {
    logoSrc: null,

    setupLogoHandling: function() {
        const logoImg = document.querySelector('.sidebar .logo');
        if (logoImg) {
            this.logoSrc = logoImg.src;
            if (!logoImg.complete) {
                logoImg.onload = () => {
                    this.logoSrc = logoImg.src;
                };
            }
        }
        
        window.addEventListener('beforeunload', () => {
            if (this.logoSrc) {
                sessionStorage.setItem('huntarr-logo-src', this.logoSrc);
            }
        });
    },

    initDarkMode: function() {
        // Huntarr is always dark — ensure the class is applied
        document.body.classList.add('dark-theme');
    }
};
