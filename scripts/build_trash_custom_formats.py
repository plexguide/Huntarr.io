#!/usr/bin/env python3
"""
Build src/primary/data/trash_custom_formats.json from TRaSH categories and formats.
Fetches full custom format JSON from TRaSH-Guides/Guides (GitHub) when available.
Falls back to local HTML file if available.
Run from repo root: python scripts/build_trash_custom_formats.py
"""
import json
import time
import re
from pathlib import Path
from html import unescape

try:
    import requests
except ImportError:
    requests = None

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "src" / "primary" / "data" / "trash_custom_formats.json"
TRASH_CF_BASE = "https://raw.githubusercontent.com/TRaSH-Guides/Guides/master/docs/json/radarr/cf"
FETCH_TIMEOUT = 15
FETCH_DELAY_SEC = 0.25
LOCAL_HTML_PATH = Path.home() / "Huntarr" / "trashinfo" / "Collection of Custom Formats - TRaSH Guides.html"


def minimal_cf_json(name):
    """Minimal valid Radarr custom format JSON."""
    return {
        "name": name,
        "includeCustomFormatWhenRenaming": False,
        "specifications": []
    }


def fetch_trash_format_json(filename):
    """
    Fetch Radarr custom format JSON from TRaSH Guides GitHub.
    filename: e.g. 'truehd-atmos' (no .json).
    Returns dict or None on failure.
    """
    if not requests:
        return None
    url = f"{TRASH_CF_BASE}/{filename}.json"
    try:
        r = requests.get(url, timeout=FETCH_TIMEOUT)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception:
        return None


def load_local_html_formats():
    """Load all custom format JSONs from local HTML file if available."""
    if not LOCAL_HTML_PATH.exists():
        return {}
    
    try:
        with open(LOCAL_HTML_PATH, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Find all JSON code blocks
        code_pattern = r'<pre id="__code_\d+">(.*?)</pre>'
        matches = re.findall(code_pattern, content, re.DOTALL)
        
        formats_by_name = {}
        for match in matches:
            clean = re.sub(r'<[^>]+>', '', match)
            clean = unescape(clean)
            clean = ' '.join(clean.split())
            
            if not clean.startswith('{'):
                continue
            
            try:
                obj = json.loads(clean)
                name = obj.get('name', '')
                if name:
                    # Convert name to format_id style
                    fmt_id = name.lower().replace('.', '-').replace(' ', '-')
                    formats_by_name[fmt_id] = obj
            except:
                pass
        
        return formats_by_name
    except Exception as e:
        print(f"Warning: Failed to load local HTML: {e}")
        return {}


def main():
    categories = [
        {
            "id": "audio-formats",
            "name": "Audio Formats",
            "formats": [
                {"id": "truehd-atmos", "name": "TrueHD ATMOS"},
                {"id": "dts-x", "name": "DTS X"},
                {"id": "atmos-undefined", "name": "ATMOS (undefined)"},
                {"id": "ddplus-atmos", "name": "DDPlus ATMOS"},
                {"id": "truehd", "name": "TrueHD"},
                {"id": "dts-hd-ma", "name": "DTS-HD MA"},
                {"id": "flac", "name": "FLAC"},
                {"id": "pcm", "name": "PCM"},
                {"id": "dts-hd-hra", "name": "DTS-HD HRA"},
                {"id": "ddplus", "name": "DDPlus"},
                {"id": "dts-es", "name": "DTS-ES"},
                {"id": "dts", "name": "DTS"},
                {"id": "aac", "name": "AAC"},
                {"id": "dd", "name": "DD"},
                {"id": "mp3", "name": "MP3"},
                {"id": "opus", "name": "Opus"},
            ]
        },
        {
            "id": "audio-channels",
            "name": "Audio Channels",
            "formats": [
                {"id": "1-0-mono", "name": "1.0 Mono"},
                {"id": "2-0-stereo", "name": "2.0 Stereo"},
                {"id": "3-0-sound", "name": "3.0 Sound"},
                {"id": "4-0-sound", "name": "4.0 Sound"},
                {"id": "5-1-surround", "name": "5.1 Surround"},
                {"id": "6-1-surround", "name": "6.1 Surround"},
                {"id": "7-1-surround", "name": "7.1 Surround"},
            ]
        },
        {
            "id": "hdr-formats",
            "name": "HDR Formats",
            "formats": [
                {"id": "hdr", "name": "HDR"},
                {"id": "dv-boost", "name": "DV-Boost"},
                {"id": "hdr10plus-boost", "name": "HDR10Plus Boost"},
            ]
        },
        {
            "id": "hdr-optional",
            "name": "HDR Optional",
            "formats": [
                {"id": "dv-disk", "name": "DV (Disk)"},
                {"id": "dv-wo-hdr-fallback", "name": "DV (w/o HDR fallback)"},
                {"id": "sdr", "name": "SDR"},
                {"id": "sdr-no-webdl", "name": "SDR (no WEBDL)"},
            ]
        },
        {
            "id": "movie-versions",
            "name": "Movie Versions",
            "formats": [
                {"id": "hybrid", "name": "Hybrid"},
                {"id": "remaster", "name": "Remaster"},
                {"id": "4k-remaster", "name": "4K Remaster"},
                {"id": "criterion-collection", "name": "Criterion Collection"},
                {"id": "masters-of-cinema", "name": "Masters of Cinema"},
                {"id": "vinegar-syndrome", "name": "Vinegar Syndrome"},
                {"id": "theatrical-cut", "name": "Theatrical Cut"},
                {"id": "special-edition", "name": "Special Edition"},
                {"id": "imax", "name": "IMAX"},
                {"id": "imax-enhanced", "name": "IMAX Enhanced"},
                {"id": "open-matte", "name": "Open Matte"},
            ]
        },
        {
            "id": "unwanted",
            "name": "Unwanted",
            "formats": [
                {"id": "av1", "name": "AV1"},
                {"id": "br-disk", "name": "BR-DISK"},
                {"id": "generated-dynamic-hdr", "name": "Generated Dynamic HDR"},
                {"id": "lq", "name": "LQ"},
                {"id": "lq-release-title", "name": "LQ (Release Title)"},
                {"id": "sing-along-versions", "name": "Sing-Along Versions"},
                {"id": "3d", "name": "3D"},
                {"id": "x265-hd", "name": "x265 (HD)"},
                {"id": "upscaled", "name": "Upscaled"},
                {"id": "extras", "name": "Extras"},
            ]
        },
        {
            "id": "miscellaneous",
            "name": "Miscellaneous",
            "formats": [
                {"id": "720p", "name": "720p"},
                {"id": "1080p", "name": "1080p"},
                {"id": "2160p", "name": "2160p"},
                {"id": "bad-dual-groups", "name": "Bad Dual Groups"},
                {"id": "black-and-white-editions", "name": "Black and White Editions"},
                {"id": "no-rlsgroup", "name": "No-RlsGroup"},
                {"id": "obfuscated", "name": "Obfuscated"},
                {"id": "retags", "name": "Retags"},
                {"id": "scene", "name": "Scene"},
                {"id": "x265-no-hdr-dv", "name": "x265 (no HDR/DV)"},
                {"id": "vc-1", "name": "VC-1"},
                {"id": "vp9", "name": "VP9"},
                {"id": "internal", "name": "Internal"},
                {"id": "line-mic-dubbed", "name": "Line/Mic Dubbed"},
                {"id": "hfr", "name": "HFR"},
                {"id": "repack-proper", "name": "Repack/Proper"},
                {"id": "repack2", "name": "Repack2"},
                {"id": "repack3", "name": "Repack3"},
                {"id": "x264", "name": "x264"},
                {"id": "x265", "name": "x265"},
                {"id": "x266", "name": "x266"},
                {"id": "freeleech", "name": "FreeLeech"},
                {"id": "dutch-groups", "name": "Dutch Groups"},
                {"id": "mpeg2", "name": "MPEG2"},
                {"id": "multi", "name": "Multi"},
            ]
        },
        {
            "id": "hq-release-groups",
            "name": "HQ Release Groups",
            "formats": [
                {"id": "remux-tier-01", "name": "Remux Tier 01"},
                {"id": "remux-tier-02", "name": "Remux Tier 02"},
                {"id": "remux-tier-03", "name": "Remux Tier 03"},
                {"id": "uhd-bluray-tier-01", "name": "UHD Bluray Tier 01"},
                {"id": "uhd-bluray-tier-02", "name": "UHD Bluray Tier 02"},
                {"id": "uhd-bluray-tier-03", "name": "UHD Bluray Tier 03"},
                {"id": "hd-bluray-tier-01", "name": "HD Bluray Tier 01"},
                {"id": "hd-bluray-tier-02", "name": "HD Bluray Tier 02"},
                {"id": "hd-bluray-tier-03", "name": "HD Bluray Tier 03"},
                {"id": "web-tier-01", "name": "WEB Tier 01"},
                {"id": "web-tier-02", "name": "WEB Tier 02"},
                {"id": "web-tier-03", "name": "WEB Tier 03"},
            ]
        },
        {
            "id": "streaming-services",
            "name": "Streaming Services",
            "subcategories": [
                {
                    "id": "general",
                    "name": "General Streaming Services",
                    "formats": [
                        {"id": "amzn", "name": "AMZN"},
                        {"id": "atv", "name": "ATV"},
                        {"id": "atvp", "name": "ATVP"},
                        {"id": "bcore", "name": "BCORE"},
                        {"id": "crit", "name": "CRiT"},
                        {"id": "dsnp", "name": "DSNP"},
                        {"id": "hbo", "name": "HBO"},
                        {"id": "hmax", "name": "HMAX"},
                        {"id": "hulu", "name": "Hulu"},
                        {"id": "it", "name": "IT"},
                        {"id": "max", "name": "Max"},
                        {"id": "ma", "name": "MA"},
                        {"id": "nf", "name": "NF"},
                        {"id": "pcok", "name": "PCOK"},
                        {"id": "pmtp", "name": "PMTP"},
                        {"id": "play", "name": "PLAY"},
                        {"id": "roku", "name": "ROKU"},
                        {"id": "stan", "name": "STAN"},
                    ]
                },
                {
                    "id": "asian",
                    "name": "Asian Streaming Services",
                    "formats": [
                        {"id": "fod", "name": "FOD"},
                        {"id": "htsr", "name": "HTSR"},
                        {"id": "tver", "name": "TVer"},
                        {"id": "tving", "name": "TVING"},
                        {"id": "u-next", "name": "U-NEXT"},
                        {"id": "viu", "name": "VIU"},
                    ]
                },
                {
                    "id": "dutch",
                    "name": "Dutch Streaming Services",
                    "formats": [
                        {"id": "pathe", "name": "Pathe"},
                        {"id": "vdl", "name": "VDL"},
                    ]
                },
                {
                    "id": "uk",
                    "name": "UK Streaming Services",
                    "formats": [
                        {"id": "ip", "name": "iP"},
                        {"id": "itvx", "name": "ITVX"},
                        {"id": "my5", "name": "MY5"},
                        {"id": "now", "name": "NOW"},
                    ]
                },
                {
                    "id": "misc",
                    "name": "Misc Streaming Services",
                    "formats": [
                        {"id": "aubc", "name": "AUBC"},
                        {"id": "cbc", "name": "CBC"},
                        {"id": "crav", "name": "Crav"},
                        {"id": "ovid", "name": "OViD"},
                        {"id": "strp", "name": "STRP"},
                    ]
                },
                {
                    "id": "anime",
                    "name": "Anime Streaming Services",
                    "formats": [
                        {"id": "vrv", "name": "VRV"},
                    ]
                },
            ]
        },
    ]

    # Load local HTML fallback if available
    local_formats = load_local_html_formats()
    if local_formats:
        print(f"Loaded {len(local_formats)} formats from local HTML file")

    format_json_by_id = {}
    fetched = 0
    skipped = 0
    from_local = 0

    def add_format(preformat_id, fmt_name, filename):
        nonlocal fetched, skipped, from_local
        cf = fetch_trash_format_json(filename)
        if cf and isinstance(cf, dict):
            if "name" not in cf or not cf["name"]:
                cf["name"] = fmt_name
            format_json_by_id[preformat_id] = cf
            fetched += 1
        elif filename in local_formats:
            cf = local_formats[filename]
            if "name" not in cf or not cf["name"]:
                cf["name"] = fmt_name
            format_json_by_id[preformat_id] = cf
            from_local += 1
        else:
            format_json_by_id[preformat_id] = minimal_cf_json(fmt_name)
            skipped += 1
        time.sleep(FETCH_DELAY_SEC)

    for cat in categories:
        cat_id = cat["id"]
        if "formats" in cat:
            for fmt in cat["formats"]:
                fid = fmt["id"]
                preformat_id = f"{cat_id}.{fid}"
                add_format(preformat_id, fmt["name"], fid)
        if "subcategories" in cat:
            for sub in cat["subcategories"]:
                sub_id = sub["id"]
                for fmt in sub["formats"]:
                    fid = fmt["id"]
                    preformat_id = f"{cat_id}.{sub_id}.{fid}"
                    add_format(preformat_id, fmt["name"], fid)

    out = {
        "categories": categories,
        "format_json_by_id": format_json_by_id,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print("Wrote", OUT_PATH)
    print(f"Fetched from GitHub: {fetched} | From local HTML: {from_local} | Fallback (minimal): {skipped}")


if __name__ == "__main__":
    main()
