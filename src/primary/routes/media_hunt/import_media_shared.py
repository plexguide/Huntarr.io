"""Shared helpers for Import Media (movie and TV). Reduces duplication between import_media_movie and import_media_tv."""

import os
import re

# Base video extensions (used by both movie and TV)
VIDEO_EXTENSIONS = frozenset(
    ('.mkv', '.mp4', '.avi', '.m4v', '.ts', '.wmv', '.flv', '.mov', '.webm', '.mpg', '.mpeg', '.m2ts')
)
# Movie-specific extras (e.g. .iso, .vob)
EXTRA_VIDEO_EXTENSIONS = frozenset(('.iso', '.vob', '.divx', '.rmvb', '.3gp'))

# Country/region suffixes commonly appended to folder names
_COUNTRY_SUFFIXES = re.compile(r'\s+\b(us|uk|au|nz|ca)\s*$', re.IGNORECASE)


def is_video_file(filename: str, extra_extensions: frozenset = None) -> bool:
    """Check if a file has a video extension."""
    if not filename:
        return False
    _, ext = os.path.splitext(filename)
    ext = ext.lower()
    if ext in VIDEO_EXTENSIONS:
        return True
    if extra_extensions and ext in extra_extensions:
        return True
    return False


def should_skip_folder(name: str, skip_pattern: re.Pattern) -> bool:
    """Check if a folder should be skipped (samples, extras, system folders)."""
    return bool(skip_pattern.match(name)) if name else False


def year_range_pattern():
    """Shared regex for extracting year from names."""
    return re.compile(r'\b(19\d{2}|20\d{2})\b')


def tmdb_pattern():
    """Shared regex for TMDB ID in folder names."""
    return re.compile(r'\{tmdb-(\d+)\}|\[tmdb[-=](\d+)\]|tmdbid[-=](\d+)', re.IGNORECASE)


# ---------------------------------------------------------------------------
# Smart normalization for confidence scoring
# ---------------------------------------------------------------------------

def normalize_for_scoring(s):
    """Advanced normalization for title comparison.

    - Lowercases
    - Strips possessives (gabby's -> gabby, show's -> show)
    - Removes all non-word/non-space characters
    - Removes single-character words (stray 's' from possessives, etc.)
    - Collapses whitespace
    """
    if not s:
        return ''
    s = s.lower().strip()
    # Handle possessives before punctuation removal
    s = re.sub(r"[''\u2019]s\b", '', s)       # gabby's -> gabby
    s = re.sub(r"s[''\u2019]\b", 's', s)      # jones' -> jones
    # Remove remaining punctuation
    s = re.sub(r'[^\w\s]', ' ', s)
    # Remove single-character words (except 'i' and 'a' which are real words)
    s = ' '.join(w for w in s.split() if len(w) > 1 or w in ('i', 'a'))
    return ' '.join(s.split())


def strip_country_suffix(s):
    """Remove trailing country codes (US, UK, AU, etc.) from a title."""
    return _COUNTRY_SUFFIXES.sub('', s).strip()


def strip_articles(s):
    """Remove leading articles (the, a, an) from a title."""
    return re.sub(r'^(the|a|an)\s+', '', s, flags=re.IGNORECASE).strip()


def title_similarity(a, b):
    """Calculate similarity between two normalized title strings (0.0-1.0).

    Uses a combination of:
    - Exact match check
    - Containment check
    - Word overlap (Jaccard)
    - Character-level bigram similarity (handles typos, missing letters)
    """
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0

    # Containment (one title is a substring of the other)
    if a in b or b in a:
        shorter = min(len(a), len(b))
        longer = max(len(a), len(b))
        return 0.7 + 0.3 * (shorter / longer)

    # Word-level Jaccard similarity
    a_words = set(a.split())
    b_words = set(b.split())
    if a_words and b_words:
        intersection = len(a_words & b_words)
        union = len(a_words | b_words)
        word_sim = intersection / union if union else 0.0
    else:
        word_sim = 0.0

    # Character bigram similarity (handles "gabbys" vs "gabby" well)
    def bigrams(s):
        return set(s[i:i+2] for i in range(len(s) - 1)) if len(s) >= 2 else set()

    a_bi = bigrams(a.replace(' ', ''))
    b_bi = bigrams(b.replace(' ', ''))
    if a_bi and b_bi:
        bi_intersection = len(a_bi & b_bi)
        bi_union = len(a_bi | b_bi)
        bigram_sim = bi_intersection / bi_union if bi_union else 0.0
    else:
        bigram_sim = 0.0

    # Weighted combination: bigrams handle char-level, words handle structure
    return max(word_sim, bigram_sim, 0.6 * word_sim + 0.4 * bigram_sim)
