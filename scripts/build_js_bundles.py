#!/usr/bin/env python3
"""
Concatenate JS files into bundles. Reduces HTTP requests from 60+ to ~15.
Run from repo root: python scripts/build_js_bundles.py

Bundles preserve original load order. Requestarr type=module files stay separate
(they use import/export; concatenation would break them).
"""

import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FRONTEND = os.path.join(REPO_ROOT, "frontend")
STATIC_JS = os.path.join(FRONTEND, "static", "js")
DIST_DIR = os.path.join(STATIC_JS, "dist")

# Groups: (output_filename, [list of paths relative to STATIC_JS])
BUNDLES = [
    (
        "bundle-core.js",
        [
            "modules/core/utils.js",
            "modules/core/helpers.js",
            "modules/core/dom.js",
            "modules/core/notifications.js",
            "modules/core/confirm-modal.js",
            "modules/core/navigation.js",
            "modules/core/theme.js",
            "modules/core/version.js",
            "modules/core/auth.js",
            "modules/core/ui-handlers.js",
            "modules/core/initialization.js",
        ],
    ),
    (
        "bundle-app.js",
        ["app.js", "app-sections.js"],
    ),
    (
        "bundle-settings.js",
        [
            "modules/features/settings/core.js",
            "modules/features/settings/instance-editor.js",
            "modules/features/settings/sonarr.js",
            "modules/features/settings/radarr.js",
            "modules/features/settings/lidarr.js",
            "modules/features/settings/readarr.js",
            "modules/features/settings/whisparr.js",
            "modules/features/settings/prowlarr.js",
            "modules/features/settings/swaparr.js",
            "modules/features/settings/indexer-editor.js",
            "modules/features/settings/indexers.js",
            "modules/features/settings/media-hunt-profiles.js",
            "modules/features/settings/profile-editor.js",
            "modules/features/settings/movie-management.js",
            "modules/features/settings/tv-management.js",
            "modules/features/settings/client-editor.js",
            "modules/features/settings/clients.js",
            "modules/features/settings/import-lists.js",
            "modules/features/settings/media-hunt-import-media.js",
            "modules/features/settings/root-folders.js",
            "modules/features/settings/remote-mappings.js",
            "modules/features/settings/custom-formats.js",
            "modules/features/settings/media-hunt-instance-management.js",
            "modules/features/settings/media-hunt-instance-editor.js",
            "modules/features/settings/logs.js",
            "modules/features/settings/notifications.js",
            "modules/features/settings/general.js",
        ],
    ),
    (
        "bundle-features.js",
        [
            "modules/features/apps/apps-main.js",
            "modules/features/logs/logs-main.js",
            "modules/features/logs/logs-core.js",
            "modules/features/instances.js",
            "modules/features/stateful.js",
            "modules/features/backup-restore.js",
            "modules/features/hunt_manager.js",
            "modules/features/scheduling.js",
            "modules/features/history.js",
            "modules/features/user.js",
            "modules/features/new-user.js",
            "modules/features/community-resources.js",
            "modules/features/github-sponsors.js",
            "modules/features/app-sponsor-rotation.js",
            "modules/features/swaparr-card.js",
            "modules/features/prowlarr.js",
            "modules/features/setup-wizard.js",
            "modules/features/huntarr-chat.js",
        ],
    ),
    (
        "bundle-media.js",
        [
            "modules/features/media-utils.js",
            "modules/features/media-hunt-instance-dropdown.js",
            "modules/features/media-hunt.js",
            "modules/features/media-hunt-filters.js",
            "modules/features/media-hunt-activity.js",
            "modules/features/media-hunt-card-delete-modal.js",
            "modules/features/media-hunt-collection-movies.js",
            "modules/features/media-hunt-collection-tv.js",
            "modules/features/media-hunt-collection.js",
            "modules/features/media-hunt-calendar.js",
            "modules/features/settings/media-hunt-custom-formats.js",
            "modules/features/settings/media-hunt-root-folders.js",
            "modules/utils/tmdb-image-cache-standalone.js",
        ],
    ),
    (
        "requestarr-bundle.js",
        [
            "modules/features/requestarr/requestarr-core-utils.js",
            "modules/features/requestarr/requestarr-filters.js",
            "modules/features/requestarr/requestarr-tv-filters.js",
            "modules/features/requestarr/requestarr-search.js",
            "modules/features/requestarr/requestarr-settings.js",
            "modules/features/requestarr/requestarr-content.js",
            "modules/features/requestarr/requestarr-modal.js",
            "modules/features/requestarr/requestarr-core.js",
            "modules/features/requestarr/requestarr-smarthunt.js",
            "modules/features/requestarr/requestarr-controller.js",
            "modules/features/requestarr/requestarr-home.js",
            "modules/features/requestarr/requestarr-users.js",
            "modules/features/requestarr/requestarr-bundles.js",
            "modules/features/requestarr/requestarr-requests.js",
            "modules/features/requestarr/user-notifications.js",
        ],
    ),
    (
        "bundle-misc.js",
        [
            "modules/features/requestarr/requestarr-detail.js",
            "modules/features/requestarr/requestarr-tv-detail.js",
            "modules/features/nzb-hunt.js",
            "modules/features/nzb-hunt-settings.js",
            "modules/features/indexer-hunt.js",
            "modules/features/indexer-hunt-home.js",
            "modules/features/indexer-hunt-stats.js",
            "modules/features/indexer-hunt-history.js",
            "modules/features/apps/sonarr.js",
            "modules/features/apps/radarr.js",
            "modules/features/apps/lidarr.js",
            "modules/features/apps/readarr.js",
            "modules/features/apps/whisparr.js",
            "modules/features/apps/eros.js",
            "modules/features/apps/swaparr-view.js",
            "modules/ui/stats.js",
            "modules/ui/api-progress.js",
            "modules/ui/cycle-countdown.js",
            "modules/ui/apps-scroll-fix.js",
            "modules/ui/card-hover-effects.js",
            "modules/ui/circular-progress.js",
            "modules/ui/background-pattern.js",
            "modules/ui/hourly-cap.js",
        ],
    ),
]


import re


def strip_es_module_syntax(content: str) -> str:
    """Strip import/export so concatenated bundle works as non-module script."""
    lines = content.split('\n')
    out = []
    for line in lines:
        stripped = line.strip()
        # Remove import statements
        if stripped.startswith('import '):
            continue
        # Remove export { X, Y }; or export { X as Y };
        if re.match(r'^export\s+\{[^}]*\}\s*;?\s*$', stripped):
            continue
        # Strip 'export ' prefix from declarations
        if stripped.startswith('export default '):
            out.append(re.sub(r'^export\s+default\s+', '', line))
        elif stripped.startswith('export '):
            out.append(re.sub(r'^(\s*)export\s+', r'\1', line))
        else:
            out.append(line)
    return '\n'.join(out)


def concat_bundle(output_name: str, files: list[str], strip_modules: bool = False) -> bool:
    """Concatenate files into one bundle. Returns True on success."""
    os.makedirs(DIST_DIR, exist_ok=True)
    out_path = os.path.join(DIST_DIR, output_name)
    parts = []
    for rel_path in files:
        full_path = os.path.join(STATIC_JS, rel_path)
        if not os.path.exists(full_path):
            print(f"  WARNING: missing {rel_path}", file=sys.stderr)
            continue
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        if strip_modules:
            content = strip_es_module_syntax(content)
        parts.append(f"\n/* === {rel_path} === */\n{content}")
    result = "\n".join(parts)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(result)
    size_kb = len(result.encode("utf-8")) / 1024
    print(f"  {output_name}: {len(files)} files, {size_kb:.1f} KB")
    return True


def main():
    print("Building JS bundles...")
    for output_name, files in BUNDLES:
        strip_modules = output_name == "requestarr-bundle.js"
        concat_bundle(output_name, files, strip_modules=strip_modules)
    print("Done. Bundles written to frontend/static/js/dist/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
