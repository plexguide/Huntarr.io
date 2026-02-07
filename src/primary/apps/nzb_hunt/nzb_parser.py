"""
NZB Parser - Parse NZB XML files to extract file and segment information.

An NZB file is an XML document that describes how to download content from Usenet.
It contains:
  - <file> elements with subject, groups, and segments
  - <segment> elements with article message-IDs, byte counts, and ordering
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import List, Optional


NZB_NAMESPACE = "http://www.newzbin.com/DTD/2003/nzb"


@dataclass
class Segment:
    """A single NNTP article segment."""
    number: int           # Segment sequence number (1-based)
    bytes: int            # Size in bytes
    message_id: str       # NNTP Message-ID (without angle brackets)


@dataclass
class NZBFile:
    """A file within an NZB, composed of ordered segments."""
    subject: str                    # Usenet subject line (contains filename)
    poster: str                     # Who posted it
    date: int                       # Unix timestamp
    groups: List[str]               # Newsgroups
    segments: List[Segment] = field(default_factory=list)

    @property
    def filename(self) -> str:
        """Extract filename from subject line. Subjects typically look like:
        'Some.Release.Name "filename.ext" yEnc (1/10)'
        """
        subject = self.subject
        # Try to extract from quotes
        start = subject.find('"')
        if start >= 0:
            end = subject.find('"', start + 1)
            if end > start:
                return subject[start + 1:end]
        # Fallback: use subject with illegal chars removed
        safe = "".join(c for c in subject if c not in '<>:"/\\|?*')
        return safe[:200] if safe else "unknown"

    @property
    def total_bytes(self) -> int:
        return sum(s.bytes for s in self.segments)


@dataclass
class NZB:
    """Parsed NZB document containing files and metadata."""
    files: List[NZBFile] = field(default_factory=list)

    @property
    def total_bytes(self) -> int:
        return sum(f.total_bytes for f in self.files)

    @property
    def total_segments(self) -> int:
        return sum(len(f.segments) for f in self.files)


def parse_nzb(content: str) -> NZB:
    """Parse NZB XML content string into an NZB object.
    
    Args:
        content: NZB XML string
        
    Returns:
        NZB object with files and segments
        
    Raises:
        ET.ParseError: If XML is malformed
        ValueError: If NZB structure is invalid
    """
    root = ET.fromstring(content)
    
    # Handle namespace - NZB files may or may not use the namespace
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"
    
    nzb = NZB()
    
    for file_el in root.findall(f"{ns}file"):
        subject = file_el.get("subject", "")
        poster = file_el.get("poster", "")
        date_str = file_el.get("date", "0")
        try:
            date = int(date_str)
        except (ValueError, TypeError):
            date = 0
        
        groups = []
        groups_el = file_el.find(f"{ns}groups")
        if groups_el is not None:
            for group_el in groups_el.findall(f"{ns}group"):
                if group_el.text:
                    groups.append(group_el.text.strip())
        
        segments = []
        segments_el = file_el.find(f"{ns}segments")
        if segments_el is not None:
            for seg_el in segments_el.findall(f"{ns}segment"):
                try:
                    number = int(seg_el.get("number", "0"))
                    seg_bytes = int(seg_el.get("bytes", "0"))
                    message_id = (seg_el.text or "").strip()
                    if message_id:
                        segments.append(Segment(
                            number=number,
                            bytes=seg_bytes,
                            message_id=message_id
                        ))
                except (ValueError, TypeError):
                    continue
        
        # Sort segments by number
        segments.sort(key=lambda s: s.number)
        
        nzb_file = NZBFile(
            subject=subject,
            poster=poster,
            date=date,
            groups=groups,
            segments=segments
        )
        nzb.files.append(nzb_file)
    
    return nzb


def parse_nzb_from_file(filepath: str) -> NZB:
    """Parse NZB from a file path."""
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        return parse_nzb(f.read())
