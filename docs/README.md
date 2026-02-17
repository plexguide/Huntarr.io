# Huntarr Documentation

This is the documentation site for [Huntarr](https://github.com/plexguide/Huntarr.io), served via GitHub Pages.

## Structure

```
docs/
├── index.html                  # Landing page
├── css/main.css                # Shared stylesheet
├── js/main.js                  # Shared JavaScript
├── images/                     # Logos and app icons
├── getting-started/
│   ├── installation.html       # Docker, Unraid, source install
│   ├── setup-wizard.html       # First-launch wizard walkthrough
│   └── first-steps.html        # Quick start guide
├── apps/
│   └── index.html              # 3rd Party Apps (all apps consolidated)
├── movie-hunt/
│   ├── index.html              # Movie Hunt overview
│   ├── media-collection.html
│   ├── indexers-clients.html
│   └── profiles.html
├── nzb-hunt/
│   └── index.html              # NZB Hunt overview
├── requestarr/
│   └── index.html              # Requests overview
├── donate.html                 # Donate / support page
├── settings/
│   ├── index.html              # Main settings
│   ├── scheduling.html
│   ├── notifications.html
│   ├── backup-restore.html
│   ├── log-settings.html
│   └── user-account.html
├── system/
│   ├── hunt-manager.html
│   ├── logs.html
│   └── api.html                # API reference
└── help/
    ├── faq.html
    └── community.html
```

## Development

This is a plain HTML static site — no build step required. Open any HTML file directly in a browser or serve with a simple HTTP server:

```bash
cd docs
python -m http.server 8000
```

Then visit http://localhost:8000.

## GitHub Pages

The site is deployed automatically from the `docs/` folder on the main branch. The `.nojekyll` file ensures GitHub Pages serves the files as-is without Jekyll processing.
