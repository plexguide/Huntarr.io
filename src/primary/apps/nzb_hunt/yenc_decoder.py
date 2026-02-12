"""
yEnc Decoder - Decode yEnc-encoded Usenet article bodies.

yEnc is the standard encoding for binary files on Usenet. It uses a simple
byte-shifting algorithm with escape sequences for special characters.

This implementation uses three strategies (fastest first):
1. sabyenc3 C extension (used by SABnzbd, ~100x faster than pure Python)
2. Fast bytes.translate() decoder (C-level bulk ops, ~50x faster)
3. Pure Python fallback (byte-by-byte, baseline)

Reference: http://www.yenc.org/yenc-draft.1.3.txt
"""

import re
from typing import Tuple, Optional

from src.primary.utils.logger import get_logger

logger = get_logger("nzb_hunt.yenc")

# ── Pre-computed lookup table: byte -> (byte - 42) & 0xFF ──
# bytes.translate() runs entirely at C level.
_YENC_TRANSLATE = bytes([(b - 42) & 0xFF for b in range(256)])

# ── Try to import sabyenc3 (SABnzbd's C extension) ──
_sabyenc3 = None
try:
    import sabyenc3 as _sabyenc3
    logger.info("sabyenc3 C extension loaded — hardware-accelerated yEnc decode")
except ImportError:
    logger.info("sabyenc3 not available — using fast bytes.translate() yEnc decoder")


def decode_yenc(data: bytes) -> Tuple[bytes, dict]:
    """Decode yEnc-encoded data from a Usenet article body.

    Uses sabyenc3 if available, otherwise a fast bytes.translate() decoder.
    """
    if _sabyenc3 is not None:
        return _decode_sabyenc3(data)
    return _decode_fast(data)


# ─────────────────────────────────────────────────────────────────────
# sabyenc3 decoder (C extension, releases GIL, ~100x faster)
# ─────────────────────────────────────────────────────────────────────

def _decode_sabyenc3(data: bytes) -> Tuple[bytes, dict]:
    """Decode using sabyenc3 C extension (same decoder SABnzbd uses)."""
    try:
        decoded, output_filename, crc, crc_expected, crc_correct = (
            _sabyenc3.decode_usenet_chunks([data], 0)
        )
        header = {}
        if output_filename:
            header["name"] = output_filename
        if crc:
            header["crc32"] = f"{crc:08x}"
        return decoded, header
    except Exception:
        return _decode_fast(data)


# ─────────────────────────────────────────────────────────────────────
# Fast Python decoder — zero-copy approach
# ─────────────────────────────────────────────────────────────────────

def _decode_fast(data: bytes) -> Tuple[bytes, dict]:
    """Decode yEnc with minimal memory copies.

    Old approach (slow):
        split into ~1000 lines → parse headers → re-join → split on '=' → translate
        = 3 full scans + 2 large allocations of the 750KB body

    New approach (fast):
        find header/trailer positions with index() → slice body directly →
        strip \\r\\n in one pass → split on '=' → translate
        = 2 scans + 1 allocation
    """
    header = {}

    # ── Find =ybegin (required) ──
    begin_pos = data.find(b"=ybegin ")
    if begin_pos == -1:
        # No yEnc header — try to decode raw
        return _yenc_decode_fast(data), header

    # Parse =ybegin line
    begin_end = data.find(b"\r\n", begin_pos)
    if begin_end == -1:
        begin_end = data.find(b"\n", begin_pos)
    if begin_end == -1:
        begin_end = len(data)
    header.update(_parse_yenc_header(data[begin_pos:begin_end]))
    body_start = begin_end + 2 if data[begin_end:begin_end + 2] == b"\r\n" else begin_end + 1

    # ── Check for =ypart (optional) ──
    if data[body_start:body_start + 7] == b"=ypart ":
        part_end = data.find(b"\r\n", body_start)
        if part_end == -1:
            part_end = data.find(b"\n", body_start)
        if part_end == -1:
            part_end = len(data)
        header.update(_parse_yenc_header(data[body_start:part_end]))
        body_start = part_end + 2 if data[part_end:part_end + 2] == b"\r\n" else part_end + 1

    # ── Find =yend (required) ──
    body_end = len(data)
    yend_pos = data.rfind(b"\r\n=yend ")
    if yend_pos == -1:
        yend_pos = data.rfind(b"\n=yend ")
    if yend_pos != -1:
        # Parse =yend trailer
        trailer_start = yend_pos + 2 if data[yend_pos] == 0x0D else yend_pos + 1
        trailer_end = data.find(b"\r\n", trailer_start)
        if trailer_end == -1:
            trailer_end = data.find(b"\n", trailer_start)
        if trailer_end == -1:
            trailer_end = len(data)
        header.update(_parse_yenc_header(data[trailer_start:trailer_end]))
        body_end = yend_pos

    # ── Extract and decode body (single slice, no split/join) ──
    body = data[body_start:body_end]
    decoded = _yenc_decode_fast(body)

    return decoded, header


def _yenc_decode_fast(data: bytes) -> bytes:
    """Decode yEnc body bytes using C-level bulk operations.

    Process:
    1. Strip \\r and \\n (C-level bytes.replace — ~750KB in microseconds)
    2. Split on '=' escape char (C-level bytes.split)
    3. Translate each chunk via table (C-level bytes.translate)

    Only escape-byte handling touches Python (~1-2% of data).
    """
    # Step 1: Strip line terminators (C-level, very fast)
    cleaned = data.replace(b"\r", b"").replace(b"\n", b"")

    # Step 2: Split on escape character
    parts = cleaned.split(b"=")

    # Step 3: Translate first chunk (no escape prefix)
    output = bytearray(parts[0].translate(_YENC_TRANSLATE))

    # Step 4: Handle escaped bytes + translate remaining data
    for i in range(1, len(parts)):
        part = parts[i]
        if part:
            # Escaped byte: (byte - 64) & 0xFF
            output.append((part[0] - 64) & 0xFF)
            if len(part) > 1:
                output.extend(part[1:].translate(_YENC_TRANSLATE))

    return bytes(output)


# ─────────────────────────────────────────────────────────────────────
# Header parsing
# ─────────────────────────────────────────────────────────────────────

def _parse_yenc_header(line: bytes) -> dict:
    """Parse a yEnc header/trailer line into a dict."""
    result = {}
    text = line.decode("ascii", errors="replace")

    # Special handling for 'name=' which can contain spaces
    name_match = re.search(r'\bname=(.+?)$', text)
    if name_match:
        result['name'] = name_match.group(1).strip()
        text = text[:name_match.start()]

    for match in re.finditer(r'\b(\w+)=(\S+)', text):
        key = match.group(1).lower()
        val = match.group(2)
        if key in ('size', 'line', 'part', 'total', 'begin', 'end'):
            try:
                result[key] = int(val)
            except ValueError:
                result[key] = val
        elif key in ('crc32', 'pcrc32'):
            result[key] = val.lower()
        else:
            result[key] = val

    return result
