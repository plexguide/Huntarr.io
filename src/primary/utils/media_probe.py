"""
media_probe.py — Lightweight media file analysis using ffprobe.

Reads only container/stream headers (no decoding), typically completes in <100ms.
Results are designed to be cached in collection items so probing only happens once per file.

Usage:
    from src.primary.utils.media_probe import probe_media_file
    info = probe_media_file('/media/movies/David (2025)/David (2025).mp4')
    # info = { 'video_codec': 'H.264', 'video_resolution': '1080p', ... } or None on error
"""

import json
import logging
import os
import subprocess
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("media_probe")


_SCAN_PROFILES: Dict[str, Dict[str, int]] = {
    # Lower values reduce read/analysis effort and system impact.
    "light": {"timeout": 2, "probesize": 1_000_000, "analyzeduration": 500_000},
    "default": {"timeout": 5, "probesize": 5_000_000, "analyzeduration": 2_000_000},
    "moderate": {"timeout": 8, "probesize": 12_000_000, "analyzeduration": 5_000_000},
    "heavy": {"timeout": 12, "probesize": 25_000_000, "analyzeduration": 10_000_000},
    "maximum": {"timeout": 20, "probesize": 50_000_000, "analyzeduration": 20_000_000},
}

# ── Codec friendly-name mappings ──────────────────────────────────────────────

_VIDEO_CODEC_MAP = {
    "h264": "H.264",
    "h265": "H.265",
    "hevc": "H.265",
    "av1": "AV1",
    "vp9": "VP9",
    "vp8": "VP8",
    "mpeg4": "MPEG-4",
    "mpeg2video": "MPEG-2",
    "mpeg1video": "MPEG-1",
    "wmv3": "WMV",
    "vc1": "VC-1",
    "theora": "Theora",
    "xvid": "XviD",
    "mjpeg": "MJPEG",
    "rawvideo": "Raw",
}

_AUDIO_CODEC_MAP = {
    "aac": "AAC",
    "ac3": "AC3",
    "eac3": "EAC3",
    "dts": "DTS",
    "truehd": "TrueHD",
    "flac": "FLAC",
    "mp3": "MP3",
    "mp2": "MP2",
    "vorbis": "Vorbis",
    "opus": "Opus",
    "pcm_s16le": "PCM",
    "pcm_s24le": "PCM 24-bit",
    "pcm_s32le": "PCM 32-bit",
    "wmav2": "WMA",
    "alac": "ALAC",
}

# ── Resolution mapping ────────────────────────────────────────────────────────

def _height_to_resolution(height: int) -> str:
    """Map pixel height to standard resolution label."""
    if height >= 2100:
        return "2160p"
    if height >= 1400:
        return "1440p"
    if height >= 1000:
        return "1080p"
    if height >= 700:
        return "720p"
    if height >= 460:
        return "480p"
    if height >= 340:
        return "360p"
    return f"{height}p"


def _channels_to_layout(channels: int) -> str:
    """Map channel count to friendly layout string."""
    layout_map = {
        1: "Mono",
        2: "Stereo",
        3: "2.1",
        6: "5.1",
        7: "6.1",
        8: "7.1",
    }
    return layout_map.get(channels, f"{channels}ch")


# ── Core probe function ───────────────────────────────────────────────────────

def _resolve_probe_profile(
    scan_profile: str,
    timeout: Optional[int],
) -> Tuple[str, int, int, int]:
    """Resolve and validate probe profile values."""
    profile = (scan_profile or "default").strip().lower()
    if profile not in _SCAN_PROFILES:
        profile = "default"
    conf = _SCAN_PROFILES[profile]
    timeout_sec = int(timeout) if timeout is not None else conf["timeout"]
    return profile, timeout_sec, conf["probesize"], conf["analyzeduration"]


def probe_media_file(
    file_path: str,
    timeout: Optional[int] = None,
    scan_profile: str = "default",
) -> Optional[Dict[str, Any]]:
    """
    Probe a media file using ffprobe and return structured metadata.

    Only reads container/stream headers — does NOT decode video frames.
    Completes in ~50-200ms for local files.

    Args:
        file_path: Absolute path to the media file.
        timeout: Optional override for ffprobe timeout seconds.
        scan_profile: One of light, default, moderate, heavy, maximum.

    Returns:
        Dict with media info, or None on any error.
        Keys: video_codec, video_resolution, video_width, video_height,
              video_bit_depth, audio_codec, audio_channels, audio_layout,
              container_format, duration_seconds, bitrate,
              probed_at, file_size
    """
    if not file_path or not os.path.isfile(file_path):
        return None

    profile, timeout_sec, probe_size, analyze_duration = _resolve_probe_profile(scan_profile, timeout)

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-probesize", str(probe_size),
                "-analyzeduration", str(analyze_duration),
                "-print_format", "json",
                "-show_streams",
                "-show_format",
                file_path,
            ],
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )

        if result.returncode != 0:
            logger.warning("ffprobe returned code %d for %s", result.returncode, file_path)
            return None

        data = json.loads(result.stdout)

    except FileNotFoundError:
        logger.info("ffprobe not found on system — media analysis unavailable")
        return None
    except subprocess.TimeoutExpired:
        logger.warning(
            "ffprobe timed out after %ss for %s (profile=%s)",
            timeout_sec,
            file_path,
            profile,
        )
        return None
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("ffprobe parse/IO error for %s: %s", file_path, exc)
        return None

    streams = data.get("streams") or []
    fmt = data.get("format") or {}

    # ── Extract video stream info ─────────────────────────────────────────
    video_codec = ""
    video_resolution = ""
    video_width = 0
    video_height = 0
    video_bit_depth = 0

    for s in streams:
        if s.get("codec_type") == "video" and s.get("codec_name") not in ("mjpeg", "png", "bmp"):
            raw_codec = (s.get("codec_name") or "").lower()
            video_codec = _VIDEO_CODEC_MAP.get(raw_codec, raw_codec.upper() if raw_codec else "")

            video_width = int(s.get("width") or 0)
            video_height = int(s.get("height") or 0)
            if video_height > 0:
                video_resolution = _height_to_resolution(video_height)

            # Bit depth from pix_fmt or bits_per_raw_sample
            bits = s.get("bits_per_raw_sample")
            if bits:
                try:
                    video_bit_depth = int(bits)
                except (ValueError, TypeError):
                    pass
            if not video_bit_depth:
                pix_fmt = (s.get("pix_fmt") or "").lower()
                if "10" in pix_fmt or "10le" in pix_fmt or "10be" in pix_fmt:
                    video_bit_depth = 10
                elif "12" in pix_fmt:
                    video_bit_depth = 12
                elif pix_fmt:
                    video_bit_depth = 8

            break  # Use first real video stream

    # ── Extract audio stream info ─────────────────────────────────────────
    audio_codec = ""
    audio_channels = 0
    audio_layout = ""

    for s in streams:
        if s.get("codec_type") == "audio":
            raw_codec = (s.get("codec_name") or "").lower()
            audio_codec = _AUDIO_CODEC_MAP.get(raw_codec, raw_codec.upper() if raw_codec else "")

            # Check profile for DTS variants (DTS-HD MA, DTS-X, etc.)
            audio_profile = (s.get("profile") or "").strip()
            if raw_codec == "dts" and audio_profile:
                ap_lower = audio_profile.lower()
                if "ma" in ap_lower or "hd ma" in ap_lower:
                    audio_codec = "DTS-HD MA"
                elif "x" in ap_lower:
                    audio_codec = "DTS:X"
                elif "hd" in ap_lower:
                    audio_codec = "DTS-HD"

            # Check for Atmos (in EAC3 or TrueHD profiles)
            if raw_codec in ("eac3", "truehd") and audio_profile:
                if "atmos" in audio_profile.lower():
                    audio_codec = audio_codec + " Atmos"

            audio_channels = int(s.get("channels") or 0)
            if audio_channels > 0:
                audio_layout = _channels_to_layout(audio_channels)

            break  # Use first audio stream

    # ── Format / container info ───────────────────────────────────────────
    container_format = (fmt.get("format_name") or "").split(",")[0].strip()
    duration_seconds = 0
    try:
        duration_seconds = round(float(fmt.get("duration") or 0))
    except (ValueError, TypeError):
        pass

    bitrate = 0
    try:
        bitrate = int(fmt.get("bit_rate") or 0)
    except (ValueError, TypeError):
        pass

    # ── File size ─────────────────────────────────────────────────────────
    try:
        file_size = os.path.getsize(file_path)
    except OSError:
        file_size = 0
    try:
        file_mtime = int(os.path.getmtime(file_path))
    except OSError:
        file_mtime = 0

    return {
        "video_codec": video_codec,
        "video_resolution": video_resolution,
        "video_width": video_width,
        "video_height": video_height,
        "video_bit_depth": video_bit_depth,
        "audio_codec": audio_codec,
        "audio_channels": audio_channels,
        "audio_layout": audio_layout,
        "container_format": container_format,
        "duration_seconds": duration_seconds,
        "bitrate": bitrate,
        "probed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "file_size": file_size,
        "file_mtime": file_mtime,
        "scan_profile": profile,
    }
