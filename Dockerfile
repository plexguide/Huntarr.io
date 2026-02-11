FROM python:3.12-slim

WORKDIR /app

# Install system dependencies including net-tools for health checks, tzdata for timezone support,
# par2 for Usenet file verification/repair, p7zip for 7z/zip extraction, gosu for PUID/PGID support,
# ffmpeg (includes ffprobe) for media file analysis, and mediainfo as a lenient fallback for MKV files
RUN apt-get update && apt-get install -y --no-install-recommends \
    net-tools \
    curl \
    wget \
    nano \
    tzdata \
    par2 \
    p7zip-full \
    gosu \
    ffmpeg \
    mediainfo \
    && rm -rf /var/lib/apt/lists/*

# Install unrar from RARLAB (full RAR5 support, unrar-free doesn't handle RAR5)
RUN wget -q https://www.rarlab.com/rar/rarlinux-x64-720.tar.gz -O /tmp/rar.tar.gz && \
    tar xzf /tmp/rar.tar.gz -C /tmp && \
    cp /tmp/rar/unrar /usr/local/bin/ && \
    chmod 755 /usr/local/bin/unrar && \
    rm -rf /tmp/rar /tmp/rar.tar.gz

# Install required packages from the root requirements file
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . /app/

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