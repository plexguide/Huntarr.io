#!/usr/bin/env bash
# Run Huntarr locally from source using venv on port 9705
# Usage: ./scripts/run-local.sh
#
# First run: Creates .venv and installs dependencies automatically.
# Config: ~/Documents/Huntarr (macOS) | ~/.config/huntarr (Linux) | %APPDATA%\Huntarr (Windows)

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
PORT=9705

# Ensure Python can find both 'src.primary' and 'primary' when running main.py
export PYTHONPATH="${REPO_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"

# Use .venv if it exists, else venv
if [ -d ".venv" ]; then
    VENV=".venv"
elif [ -d "venv" ]; then
    VENV="venv"
else
    echo "No venv found. Creating .venv and installing dependencies..."
    python3 -m venv .venv
    VENV=".venv"
    source "$VENV/bin/activate"
    pip install -q -r requirements.txt
    echo "Done. Starting Huntarr..."
    echo ""
fi

source "$VENV/bin/activate"

echo "Starting Huntarr on port $PORT"
echo "Open: http://localhost:$PORT"
echo ""

export HUNTARR_PORT="$PORT"
exec python3 main.py
