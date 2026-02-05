# Instance ID Implementation – Code Review

## Summary

Stable `instance_id` (format: `app-YYMMDDHHMMxxx`) is used for all DB keying so renaming an instance in the UI does not break tracking. Display name (`instance_name`) is used only for logs and UI.

---

## 1. Backward Compatibility

### New installs
- No `instance_id` in settings → first run generates one, saves to settings, runs migration (no-op when no rows exist).
- All per-instance tables end up keyed by `instance_id`.

### Existing installs (legacy)
- **Multi-instance**: Settings have `instances[].name` but no `instance_id`. On first load, `get_configured_instances()` generates `instance_id`, writes it to `settings["instances"][idx]["instance_id"]`, calls `save_settings()`, then `migrate_instance_identifier(app_type, old_instance_name, new_instance_id)`.
- **Legacy single-instance** (e.g. Radarr with no `instances` list): `instance_id` is generated and stored at `settings["instance_id"]`; migration runs for `"Default"` → `legacy_id`.
- **Idempotency**: Migration does `UPDATE ... WHERE instance_name = old_name`. After the first run there are no rows left with `old_name`, so a second run updates 0 rows. Safe to call multiple times.

### Fallback when `instance_id` is missing
- Everywhere we use: `instance_key = instance_details.get("instance_id") or instance_details.get("instance_name", "Default")`.
- So old configs without `instance_id` still work (keyed by name until the next run assigns an id).

---

## 2. Database Safety

### Migration (migrate_instance_identifier)
- **Tables updated**: `sleep_data_per_instance`, `hourly_caps_per_instance`, `reset_requests_per_instance`, `media_stats_per_instance` (by column `instance_name`), then `migrate_instance_state_management` for stateful + hunt_history.
- **Fix applied**: `stateful_processed_ids` has no `updated_at` column; migration only does `SET instance_name = ?` for that table (no `updated_at`).
- **Conflict**: If the new id already has rows (shouldn’t happen on first assign), `migrate_instance_state_management` skips to avoid overwriting.

### Schema
- All per-instance tables use a single column (e.g. `instance_name`) to store the instance key; that value is now `instance_id` after migration. No schema change required.

---

## 3. Consistency of instance_key vs instance_name

### Background (background.py)
- **Cycle / sleep / reset / cap / state**: All use `instance_key` (e.g. `start_cycle`, `end_cycle`, `_has_pending_reset`, `set_cycle_activity`, `clear_cycle_activity`, `check_hourly_cap_exceeded`, `get_hourly_cap_status`, `initialize_instance_state_management`, `reset_instance_state_management`, `get_state_management_summary`).
- **Sleep lookups**: `_get_instances_due_and_sleep` and `_get_sleep_seconds_until_next_cycle` use `inst.get("instance_id") or inst.get("instance_name", "Default")`.
- **Responsive sleep reset check**: Uses `inst.get("instance_id") or inst.get("instance_name", "Default")`.
- **Logs and return values**: Use `instance_name` (display).

### Apps (process_missing / process_upgrades)
- **Sonarr**: Receives `instance_name=instance_key` from background; all DB/history uses that (stable id).
- **Radarr, Lidarr, Readarr, Whisparr, Eros**: Use `instance_key = app_settings.get("instance_id") or instance_name` and use `instance_key` for:
  - `is_processed`, `add_processed_id`, `increment_stat` / `increment_stat_only`, `log_processed_media`.
- **Fixes applied in this review**:
  - Readarr upgrade: `is_processed("readarr", instance_key, ...)` (was `instance_name`).
  - Readarr missing: `add_processed_id("readarr", instance_key, ...)` (was `instance_name`).
  - Whisparr upgrade: `add_processed_id("whisparr", instance_key, ...)` (was `instance_name`).
  - Lidarr missing: `is_processed("lidarr", instance_key, str(eid))` for artist filter; `log_processed_media(..., instance_key, "missing")` (was `instance_name` where it affected DB).

### Cycle tracker (cycle_tracker.py)
- Uses `get_configured_instances()` to get `(instance_name, instance_id)`.
- Response remains keyed by display name for the API.
- `pending_reset` and DB merge use `instance_id`; `_cycle_activity` is keyed by `instance_id` (same as in background).

### Stateful routes (stateful_routes.py)
- `_resolve_instance_id(app_type, instance_name)` resolves display name → `instance_id` via `get_configured_instances()`.
- Reset and summary use the resolved id for DB; messages still use display name where appropriate.

### Web server (web_server.py)
- Reset request: resolves request `instance_name` to `instance_id` via `get_configured_instances()` before `create_reset_request(app_name, instance_identifier)`.

---

## 4. ID Generation and Concurrency

- **Format**: `app_type-YYMMDDHHMM` + 3 random alphanumeric; collision avoided by checking `existing_ids` (from current app instances).
- **Possible race**: If two threads call `get_configured_instances()` for the same app while an instance has no id, both could generate an id in the same second. Mitigation: same-second ids are unlikely to collide due to 3-char suffix; if they did, both would end up with the same id (no DB corruption). A stricter fix would be a short lock around generate+save per app (optional).

---

## 5. History and Rename Handling

- **hunt_history**: `instance_name` column now stores `instance_id` (all callers pass `instance_key`).
- **handle_instance_rename**: History is keyed by `instance_id`, so display-name renames do not require updating history. `HuntarrDatabase.handle_instance_rename()` is implemented as a no-op (returns True) for API compatibility with `history_manager`; no DB updates.

---

## 6. Frontend / API Contract

- **Cycle status API**: Still returns instances keyed by display name; `pending_reset` and next_cycle are resolved via `instance_id` internally.
- **Reset request**: Request body/query can send display name; backend resolves to `instance_id` before creating the reset.
- **Stateful summary/reset**: Query params use display name; backend resolves to `instance_id` for DB.

No breaking change for existing frontends.

---

## 7. Checklist for Deployments

- [x] New installs: get `instance_id` on first run and persist.
- [x] Legacy single-instance: get default `instance_id` and persist.
- [x] Migration: all relevant tables updated from name → id; idempotent; no `updated_at` on `stateful_processed_ids`.
- [x] All apps use `instance_key` for is_processed, add_processed_id, increment_stat, log_processed_media (Readarr, Whisparr, Lidarr fixes applied).
- [x] Sleep/reset/cap/state/cycle use `instance_key` everywhere in background and cycle_tracker.
- [x] Stateful and reset APIs resolve display name → id where needed.
- [x] No schema change; column names unchanged (value is now id).
- [x] **stats_manager**: Hourly cap limit lookup supports `instance_id`; get_stats and load_hourly_caps_for_api use instance_id for DB lookups and display name for API keys.

---

## 8. Final Review Fixes (stats_manager)

- ** _get_instance_hourly_cap_limit**: When `get_hourly_cap_status` is called with `instance_key` (id), the limit lookup failed because it only matched `inst.get("name")` and `inst.get("instance_name")`. Added `inst.get("instance_id") == instance_key` so limit is resolved correctly when key is an id.
- **get_stats**: Was building `instance_names` from display names and looking up `per_instance_caps.get(name)`, `by_name.get(name)` (DB is keyed by instance_id after migration). Fixed by using `get_configured_instances()` to get (display_name, instance_id), then looking up stats/caps/lock by `instance_id` and outputting with `instance_name: display_name`.
- **load_hourly_caps_for_api**: Same mismatch (output keyed by display name but DB keyed by id). Fixed by iterating configured instances and mapping `instance_id` → DB data, `display_name` → output key.

---

## 9. Files Touched (Reference)

- `src/primary/utils/instance_id.py` – ID generation.
- `src/primary/utils/database.py` – Migration (identifier + state management); `stateful_processed_ids` UPDATE fixed.
- `src/primary/background.py` – instance_key for all cycle/state/cap/sleep; sleep lookups by id.
- `src/primary/cycle_tracker.py` – get_configured_instances; response by display name, lookups by id.
- `src/primary/stateful_routes.py` – resolve to id for summary/reset.
- `src/primary/web_server.py` – resolve to id for reset request.
- `src/primary/apps/{sonarr,radarr,lidarr,readarr,whisparr,eros}/__init__.py` – assign and persist instance_id; include in returned instance dict.
- `src/primary/apps/readarr/upgrade.py`, `readarr/missing.py`, `whisparr/upgrade.py`, `lidarr/missing.py` – use instance_key for DB-related calls (fixes applied in this review).
- `src/primary/stats_manager.py` – _get_instance_hourly_cap_limit matches instance_id; get_stats and load_hourly_caps_for_api use instance_id for DB lookups, display name for API keys.