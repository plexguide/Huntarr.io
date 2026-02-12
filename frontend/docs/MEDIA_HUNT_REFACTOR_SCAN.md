# Media Hunt Refactor Scan

Scan date: after consolidating movie-hunt / tv-hunt into media-hunt (sections, collection, filters, instance editor, instance dropdown, activity, detail script).

## Already consolidated (no action)

- **media_hunt_section.html** – one section for discover + collection; mode-driven.
- **media-hunt.js** – discover (movie + TV) with `_mediaHuntSectionMode`.
- **media-hunt-collection.js** – MovieHuntCollection + TVHuntCollection + MediaHuntCollection wrapper.
- **media-hunt-filters.js** – filters for movie discover (MediaHuntFilters).
- **media-hunt-instance-editor.js** – Movie + TV instance editors; shared container IDs.
- **media-hunt-instance-dropdown.js** – one implementation + Movie/TV wrappers.
- **media-hunt-activity.js** – ActivityModule (movie) + TVHuntActivityModule (TV).
- **media-hunt-detail.js** – movie detail (still exposed as MovieHuntDetail).
- **media_hunt_instance_editor_section.html** – one section for both.
- **media_hunt_instance_management_section.html** – mode-driven.
- **media_hunt_profiles_section.html** – mode-driven.
- **media_hunt_calendar_section.html** – shared calendar (mode in JS).

## Recommended naming / consistency refactors (DONE)

1. **index.html** – Update comments: "Movie Hunt Section" → "Media Hunt Section", "Movie Hunt Settings default" → "Media Hunt (Movie) settings", Activity comments to "Media Hunt Activity (Movie/TV)".
2. **media_hunt_section.html** – Use `media-hunt-beta-notice` (and keep `.movie-hunt-beta-notice` in CSS as alias so styles still apply, or rename in CSS too).
3. **CSS** – Rename for consistency:
   - `movie-hunt.css` → `media-hunt.css` (update links in media_hunt_section.html, requestarr-discover.css comment).
   - `movie-hunt-calendar.css` → `media-hunt-calendar.css` (update link and selectors; calendar template already has `media-hunt-calendar-view`).
   - Keep `movie-hunt-detail.css` and `tv-hunt.css` as-is (detail is movie-only; tv-hunt.css is TV-specific styles).
4. **movie_hunt_settings_default_section.html** – Rename to `media_hunt_settings_default_section.html` and update index include (or leave name if it’s the “movie” settings default page).
5. **media_hunt_calendar_section.html** – Use only `media-hunt-calendar-view` and ensure CSS uses that selector after calendar CSS rename.

## Intentionally left split (no refactor)

- **Sidebars** – `#movie-hunt-sidebar` and `#tv-hunt-sidebar` stay separate (different nav items and routes).
- **Section hashes** – `#movie-hunt-*` and `#tv-hunt-*` stay (routing and nav).
- **TV Hunt settings** – `tv_hunt_settings_*.html` and `tv-hunt-custom-formats.js`, `tv-hunt-root-folders.js` stay (TV-specific settings; Movie uses global Settings).
- **Activity templates** – `activity_section.html` (movie) and `tv_hunt_activity_section.html` (TV) stay (different DOM IDs; one JS file serves both).
- **API paths** – `/api/movie-hunt/` and `/api/tv-hunt/` unchanged (backend).

## Optional later (larger UX)

- Single “Media Hunt” sidebar with Movie/TV as sub-modes (bigger nav/UX change).
- Merge TV settings into a unified “Media Hunt Settings” with mode (large product change).
- Rename `movie-card-delete-modal.js` → `media-hunt-card-delete-modal.js` (cosmetic).
