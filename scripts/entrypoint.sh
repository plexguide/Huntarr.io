#!/bin/bash
# Huntarr Docker Entrypoint
# Supports PUID/PGID for running as non-root user
# If PUID/PGID are not set (or set to 0), runs as root (backward compatible)

set -e

PUID=${PUID:-0}
PGID=${PGID:-0}

# If running as root (default / backward compatible)
if [ "$PUID" -eq 0 ] && [ "$PGID" -eq 0 ]; then
    echo "[entrypoint] Running as root (no PUID/PGID set)"
    exec python3 main.py
fi

# Running as non-root user
echo "[entrypoint] Setting up user with PUID=$PUID and PGID=$PGID"

# Create/modify group - handle existing GID gracefully
EXISTING_GROUP=$(getent group "$PGID" 2>/dev/null | cut -d: -f1 || true)
if [ -z "$EXISTING_GROUP" ]; then
    groupadd -g "$PGID" huntarr
    HUNTARR_GROUP="huntarr"
else
    HUNTARR_GROUP="$EXISTING_GROUP"
fi

# Create/modify user - handle existing UID gracefully
EXISTING_USER=$(getent passwd "$PUID" 2>/dev/null | cut -d: -f1 || true)
if [ -z "$EXISTING_USER" ]; then
    useradd -o -u "$PUID" -g "$HUNTARR_GROUP" -d /app -s /bin/bash -M --no-log-init huntarr 2>/dev/null
    HUNTARR_USER="huntarr"
else
    HUNTARR_USER="$EXISTING_USER"
    # Make sure the existing user is in the right group
    usermod -g "$HUNTARR_GROUP" "$HUNTARR_USER" 2>/dev/null || true
fi

echo "[entrypoint] Using user=$HUNTARR_USER (UID=$PUID) group=$HUNTARR_GROUP (GID=$PGID)"

# Fix ownership of directories the app needs to write to
# /config is the main data directory (database, logs, settings)
echo "[entrypoint] Fixing ownership of /config..."
chown -R "$PUID:$PGID" /config

# /app needs to be readable (and some temp/cache files may be written)
# Only chown if not already correct to speed up startup
APP_OWNER=$(stat -c '%u' /app 2>/dev/null || echo "0")
if [ "$APP_OWNER" != "$PUID" ]; then
    echo "[entrypoint] Fixing ownership of /app..."
    chown -R "$PUID:$PGID" /app
fi

# Don't chown /media or /downloads - those are external mounts
# The user is responsible for ensuring PUID/PGID can access them
# (same convention as Sonarr, Radarr, and all LinuxServer.io containers)

# Drop privileges and run as the target user
echo "[entrypoint] Starting Huntarr as UID=$PUID GID=$PGID"
exec gosu "$PUID:$PGID" python3 main.py
