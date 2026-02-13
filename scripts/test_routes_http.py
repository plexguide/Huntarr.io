#!/usr/bin/env python3
"""Test refactored routes via HTTP. Run: python3 scripts/test_routes_http.py [base_url]"""
import sys
import json

import urllib.request

def get(url):
    req = urllib.request.Request(url)
    r = urllib.request.urlopen(req, timeout=10)
    data = r.read().decode()
    try:
        return r.getcode(), json.loads(data) if data else {}
    except json.JSONDecodeError:
        return r.getcode(), {}

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://10.0.0.10:9720"

routes = [
    ("/api/health", ["status", "message"]),
    ("/api/indexers", ["indexers"]),
    ("/api/indexers/presets", ["presets", "all_categories"]),
    ("/api/clients", ["clients"]),
    ("/api/custom-formats", ["custom_formats"]),
    ("/api/tv-hunt/indexers", ["indexers"]),
    ("/api/tv-hunt/indexers/presets", ["presets"]),
    ("/api/tv-hunt/clients", ["clients"]),
    ("/api/tv-hunt/custom-formats", ["custom_formats"]),
    ("/api/tv-hunt/queue", ["queue"]),
    ("/api/tv-hunt/history", ["history"]),
    ("/api/tv-hunt/blocklist", ["items"]),
]

errs = []
for path, keys in routes:
    url = BASE + path
    try:
        code, data = get(url)
        if code != 200:
            errs.append(f"{path}: HTTP {code}")
        elif not all(k in data for k in keys):
            errs.append(f"{path}: missing keys {keys}")
        else:
            print(f"OK {path}")
    except Exception as e:
        errs.append(f"{path}: {e}")

if errs:
    print("\nFAILED:", errs, file=sys.stderr)
    sys.exit(1)
print("\nAll refactored routes OK.")
sys.exit(0)
