FROM python:3.9-slim

WORKDIR /app

# Install system dependencies including net-tools for health checks and tzdata for timezone support
RUN apt-get update && apt-get install -y --no-install-recommends \
    net-tools \
    curl \
    wget \
    nano \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Install required packages from the root requirements file
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . /app/

# Create necessary directories
# Log files are now stored in database only
RUN mkdir -p /config && chmod -R 755 /config

# Set environment variables
ENV PYTHONPATH=/app
ENV TZ=UTC
# ENV APP_TYPE=sonarr # APP_TYPE is likely managed via config now, remove if not needed

# Expose port
EXPOSE 9705

# Add health check for Docker using Python to avoid spawning curl processes
# The SIGCHLD handler in main.py will reap any terminated health check processes
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["python3", "-c", "import requests; import sys; r = requests.get('http://localhost:9705/api/health', timeout=5); sys.exit(0 if r.status_code == 200 else 1)"]

# Run the main application using the new entry point
CMD ["python3", "main.py"]