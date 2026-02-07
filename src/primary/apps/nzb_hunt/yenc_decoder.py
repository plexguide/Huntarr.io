"""
yEnc Decoder - Decode yEnc-encoded Usenet article bodies.

yEnc is the standard encoding for binary files on Usenet. It uses a simple
byte-shifting algorithm with escape sequences for special characters.

Reference: http://www.yenc.org/yenc-draft.1.3.txt
"""

import re
from typing import Tuple, Optional


# yEnc escape character
YENC_ESCAPE = 0x3D  # '='

# Characters that are escaped in yEnc
YENC_CRITICAL = {0x00, 0x0A, 0x0D, YENC_ESCAPE}


def decode_yenc(data: bytes) -> Tuple[bytes, dict]:
    """Decode yEnc-encoded data from a Usenet article body.
    
    Args:
        data: Raw article body bytes
        
    Returns:
        Tuple of (decoded_bytes, header_info_dict)
        header_info contains: name, size, line, part, begin, end, total, crc32
    """
    lines = data.split(b"\r\n")
    if not lines:
        lines = data.split(b"\n")
    
    header = {}
    body_start = 0
    body_end = len(lines)
    
    # Find =ybegin header
    for i, line in enumerate(lines):
        if line.startswith(b"=ybegin "):
            header.update(_parse_yenc_header(line))
            body_start = i + 1
            break
    
    # Check for =ypart header (multi-part)
    if body_start < len(lines) and lines[body_start].startswith(b"=ypart "):
        header.update(_parse_yenc_header(lines[body_start]))
        body_start += 1
    
    # Find =yend trailer
    trailer = {}
    for i in range(len(lines) - 1, body_start - 1, -1):
        if lines[i].startswith(b"=yend "):
            trailer = _parse_yenc_header(lines[i])
            body_end = i
            break
    
    header.update(trailer)
    
    # Decode the body
    body_data = b"\r\n".join(lines[body_start:body_end])
    decoded = _yenc_decode_bytes(body_data)
    
    return decoded, header


def _parse_yenc_header(line: bytes) -> dict:
    """Parse a yEnc header/trailer line into a dict.
    
    Headers look like: =ybegin part=1 total=10 line=128 size=123456 name=file.rar
    """
    result = {}
    text = line.decode("ascii", errors="replace")
    
    # Extract key=value pairs
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


def _yenc_decode_bytes(data: bytes) -> bytes:
    """Decode yEnc body bytes to original binary data.
    
    Algorithm:
    - For each byte: subtract 42 (mod 256) to get original
    - Escape sequences: '=' followed by byte means (byte - 106) mod 256
    - Skip \\r and \\n in input
    """
    result = bytearray()
    i = 0
    length = len(data)
    
    while i < length:
        byte = data[i]
        
        if byte == 0x0D or byte == 0x0A:  # \r or \n
            i += 1
            continue
        
        if byte == YENC_ESCAPE and i + 1 < length:
            i += 1
            byte = (data[i] - 64) & 0xFF
        else:
            byte = (byte - 42) & 0xFF
        
        result.append(byte)
        i += 1
    
    return bytes(result)
