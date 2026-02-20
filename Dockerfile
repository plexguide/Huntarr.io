FROM python:3.12-slim

WORKDIR /app

# Layer 1: System deps + unrar + build tools + pip install in ONE layer.
# Combining into a single RUN avoids re-downloading apt packages when only
# requirements.txt changes, and keeps the final image smaller (one apt cache cleanup).
# The COPY of requirements.txt is separate so Docker can cache this heavy layer
# as long as requirements.txt is unchanged.
COPY requirements.txt /app/

# TARGETARCH is set automatically by Docker Buildx (amd64 or arm64)
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
        net-tools curl wget nano tzdata par2 p7zip-full gosu ffmpeg mediainfo \
        build-essential python3-dev && \
    # Install unrar: RARLAB binary on amd64 (full RAR5), Debian package on arm64
    if [ "$TARGETARCH" = "amd64" ]; then \
        wget -q https://www.rarlab.com/rar/rarlinux-x64-720.tar.gz -O /tmp/rar.tar.gz && \
        echo "d3e7fba3272385b1d0255ee332a1e8c1a6779bb5a5ff9d4d8ac2be846e49ca46  /tmp/rar.tar.gz" | sha256sum -c - && \
        tar xzf /tmp/rar.tar.gz -C /tmp && cp /tmp/rar/unrar /usr/local/bin/ && chmod 755 /usr/local/bin/unrar && \
        rm -rf /tmp/rar /tmp/rar.tar.gz; \
    else \
        apt-get install -y --no-install-recommends unrar-free && \
        ln -sf /usr/bin/unrar-free /usr/local/bin/unrar; \
    fi && \
    # Install Python deps (sabyenc3 needs build-essential to compile)
    pip install --no-cache-dir -r requirements.txt && \
    # Remove build tools to keep image lean
    apt-get purge -y build-essential python3-dev && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Copy application code
COPY . /app/

# Build JS bundles (Python concat only - no npm/Vite)
RUN python3 scripts/build_js_bundles.py

# Create necessary directories (config for app data; /media and /downloads for Docker mounts)
RUN mkdir -p /config /media /downloads && chmod -R 755 /config /media /downloads

# Make entrypoint executable
RUN chmod +x /app/scripts/entrypoint.sh

# Set environment variables
ENV PYTHONPATH=/app
ENV TZ=UTC

# PUID/PGID: Set to non-zero to run as non-root user (default: 0 = root for backward compatibility)
# Unraid: PUID=99 PGID=100 | Linux: PUID=1000 PGID=1000
ENV PUID=0
ENV PGID=0

# Expose port
EXPOSE 9705

# Add health check for Docker using Python to avoid spawning curl processes
# The SIGCHLD handler in main.py will reap any terminated health check processes
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["python3", "-c", "import requests; import sys; r = requests.get('http://localhost:9705/api/health', timeout=5); sys.exit(0 if r.status_code == 200 else 1)"]

# Use entrypoint for PUID/PGID support, falling back to root if not set
ENTRYPOINT ["/app/scripts/entrypoint.sh"]