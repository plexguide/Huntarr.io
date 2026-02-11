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
    # Radarr uses 50MB probesize as default and retries at 150MB/150M for audio.
    # Our profiles are aligned with Radarr's proven values for reliable scanning.
    "light":    {"timeout":  5, "probesize":  10_000_000, "analyzeduration":   5_000_000},
    "default":  {"timeout": 10, "probesize":  50_000_000, "analyzeduration":  20_000_000},
    "moderate": {"timeout": 15, "probesize":  75_000_000, "analyzeduration":  50_000_000},
    "heavy":    {"timeout": 20, "probesize": 100_000_000, "analyzeduration": 100_000_000},
    "maximum":  {"timeout": 30, "probesize": 150_000_000, "analyzeduration": 150_000_000},
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


# ── mediainfo fallback ────────────────────────────────────────────────────────

def _probe_with_mediainfo(
    file_path: str,
    timeout_sec: int = 10,
) -> Optional[Dict[str, Any]]:
    """
    Fallback probe using mediainfo CLI when ffprobe fails (e.g. strict EBML in MKV).
    Returns the same dict shape as probe_media_file, or None on error.
    """
    try:
        result = subprocess.run(
            ["mediainfo", "--Output=JSON", file_path],
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        if result.returncode != 0:
            return None

        data = json.loads(result.stdout)
    except FileNotFoundError:
        logger.info("mediainfo not found on system — fallback unavailable")
        return None
    except subprocess.TimeoutExpired:
        logger.warning("mediainfo timed out for %s", file_path)
        return None
    except (json.JSONDecodeError, OSError) as exc:
        logger.debug("mediainfo parse error for %s: %s", file_path, exc)
        return None

    tracks = []
    media = data.get("media") or data
    if isinstance(media, dict):
        tracks = media.get("track") or []
    if not tracks:
        return None

    video_codec = ""
    video_resolution = ""
    video_width = 0
    video_height = 0
    video_bit_depth = 0
    audio_codec = ""
    audio_channels = 0
    audio_layout = ""
    container_format = ""
    duration_seconds = 0
    bitrate = 0

    for track in tracks:
        track_type = (track.get("@type") or "").lower()

        if track_type == "general":
            container_format = (track.get("Format") or "").split(",")[0].strip()
            dur = track.get("Duration")
            if dur:
                try:
                    duration_seconds = round(float(dur))
                except (ValueError, TypeError):
                    pass
            br = track.get("OverallBitRate")
            if br:
                try:
                    bitrate = int(br)
                except (ValueError, TypeError):
                    pass

        elif track_type == "video" and not video_codec:
            raw_codec = (track.get("Format") or "").lower()
            # Map common mediainfo format names
            mi_video_map = {
                "avc": "H.264", "h.264": "H.264", "h264": "H.264",
                "hevc": "H.265", "h.265": "H.265", "h265": "H.265",
                "av1": "AV1", "vp9": "VP9", "vp8": "VP8",
                "mpeg-4 visual": "MPEG-4", "mpeg video": "MPEG-2",
                "vc-1": "VC-1", "xvid": "XviD",
            }
            video_codec = mi_video_map.get(raw_codec, _VIDEO_CODEC_MAP.get(raw_codec, raw_codec.upper() if raw_codec else ""))

            try:
                video_width = int(track.get("Width") or 0)
            except (ValueError, TypeError):
                video_width = 0
            try:
                video_height = int(track.get("Height") or 0)
            except (ValueError, TypeError):
                video_height = 0
            if video_height > 0:
                video_resolution = _height_to_resolution(video_height)

            bd = track.get("BitDepth")
            if bd:
                try:
                    video_bit_depth = int(bd)
                except (ValueError, TypeError):
                    pass

        elif track_type == "audio" and not audio_codec:
            raw_codec = (track.get("Format") or "").lower()
            mi_audio_map = {
                "aac": "AAC", "ac-3": "AC3", "e-ac-3": "EAC3",
                "dts": "DTS", "mlp fba": "TrueHD", "flac": "FLAC",
                "mpeg audio": "MP3", "vorbis": "Vorbis", "opus": "Opus",
                "pcm": "PCM", "alac": "ALAC", "wma": "WMA",
            }
            audio_codec = mi_audio_map.get(raw_codec, _AUDIO_CODEC_MAP.get(raw_codec, raw_codec.upper() if raw_codec else ""))

            # Check for DTS variants
            commercial = (track.get("Format_Commercial_IfAny") or "").lower()
            if "dts" in raw_codec:
                if "ma" in commercial or "hd ma" in commercial:
                    audio_codec = "DTS-HD MA"
                elif "dts:x" in commercial or "dts-x" in commercial:
                    audio_codec = "DTS:X"
                elif "hd" in commercial:
                    audio_codec = "DTS-HD"
            # Check for Atmos
            if "atmos" in commercial:
                audio_codec = audio_codec + " Atmos"

            ch = track.get("Channels")
            if ch:
                try:
                    audio_channels = int(ch)
                    audio_layout = _channels_to_layout(audio_channels)
                except (ValueError, TypeError):
                    pass

    if not video_codec and not audio_codec:
        return None  # mediainfo couldn't parse anything useful

    # ── File metadata ─────────────────────────────────────────────────────
    try:
        file_size = os.path.getsize(file_path)
    except OSError:
        file_size = 0
    try:
        file_mtime = int(os.path.getmtime(file_path))
    except OSError:
        file_mtime = 0

    logger.debug("mediainfo fallback succeeded for %s: %s %s", file_path, video_resolution, video_codec)

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
        "scan_profile": "mediainfo",  # mark as mediainfo-sourced
    }


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

    # ── Try ffprobe first ─────────────────────────────────────────────────
    streams = []
    fmt = {}
    ffprobe_ok = False

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

        if result.returncode == 0:
            data = json.loads(result.stdout)
            streams = data.get("streams") or []
            fmt = data.get("format") or {}
            if streams:
                ffprobe_ok = True

                # Radarr pattern: retry with larger probesize if audio channels missing
                audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
                if audio_stream and not audio_stream.get("channels") and profile != "maximum":
                    max_conf = _SCAN_PROFILES["maximum"]
                    try:
                        retry = subprocess.run(
                            [
                                "ffprobe", "-v", "quiet",
                                "-probesize", str(max_conf["probesize"]),
                                "-analyzeduration", str(max_conf["analyzeduration"]),
                                "-print_format", "json",
                                "-show_streams", "-show_format",
                                file_path,
                            ],
                            capture_output=True, text=True,
                            timeout=max_conf["timeout"],
                        )
                        if retry.returncode == 0:
                            retry_data = json.loads(retry.stdout)
                            retry_streams = retry_data.get("streams") or []
                            if retry_streams:
                                streams = retry_streams
                                fmt = retry_data.get("format") or fmt
                                logger.debug("Retry with larger probesize succeeded for %s", file_path)
                    except Exception:
                        pass  # keep original results

    except FileNotFoundError:
        logger.info("ffprobe not found on system")
    except subprocess.TimeoutExpired:
        logger.warning("ffprobe timed out after %ss for %s (profile=%s)", timeout_sec, file_path, profile)
    except (json.JSONDecodeError, OSError) as exc:
        logger.debug("ffprobe parse/IO error for %s: %s", file_path, exc)

    # ── Fallback to mediainfo if ffprobe got no streams ───────────────────
    if not ffprobe_ok:
        mi_result = _probe_with_mediainfo(file_path, timeout_sec)
        if mi_result:
            return mi_result
        # Both failed
        return None

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
