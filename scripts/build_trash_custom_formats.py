#!/usr/bin/env python3
"""
Build src/primary/data/trash_custom_formats.json from TRaSH categories and formats.
Run from repo root: python scripts/build_trash_custom_formats.py
"""
import json
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "src" / "primary" / "data" / "trash_custom_formats.json"


def minimal_cf_json(name):
    """Minimal valid Radarr custom format JSON."""
    return {
        "name": name,
        "includeCustomFormatWhenRenaming": False,
        "specifications": []
    }


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

    format_json_by_id = {}

    for cat in categories:
        cat_id = cat["id"]
        if "formats" in cat:
            for fmt in cat["formats"]:
                fid = fmt["id"]
                preformat_id = f"{cat_id}.{fid}"
                format_json_by_id[preformat_id] = minimal_cf_json(fmt["name"])
        if "subcategories" in cat:
            for sub in cat["subcategories"]:
                sub_id = sub["id"]
                for fmt in sub["formats"]:
                    fid = fmt["id"]
                    preformat_id = f"{cat_id}.{sub_id}.{fid}"
                    format_json_by_id[preformat_id] = minimal_cf_json(fmt["name"])

    out = {
        "categories": categories,
        "format_json_by_id": format_json_by_id,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print("Wrote", OUT_PATH)


if __name__ == "__main__":
    main()
