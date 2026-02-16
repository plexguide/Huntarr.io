"""
Media Rename Engine
Shared format-token engine for Movie Hunt and TV Hunt file/folder renaming.
Parses release names for quality/codec/group info and applies user-configured
format strings with token replacement — matching Radarr/Sonarr behaviour.
"""

import re
import os
import logging
import unicodedata

logger = logging.getLogger(__name__)


# ── Release Name Parser ──────────────────────────────────────────────────────

_RE_RESOLUTION = re.compile(
    r'\b(2160p|1080p|1080i|720p|576p|480p|480i|360p)\b', re.IGNORECASE)

_RE_SOURCE = re.compile(
    r'\b('
    r'Blu[\s.\-]?Ray|BluRay|BDRip|BRRip|BD(?:Remux)?|BDMV|'
    r'WEB[\s.\-]?DL|WEBDL|WEBRip|WEB|'
    r'HDTV|PDTV|SDTV|'
    r'DVD(?:Rip)?|DVDScr|'
    r'Remux|'
    r'CAM|TS|TELESYNC|TC|TELECINE|SCR|SCREENER|R5|'
    r'HDDVD|HD[\s.\-]?DVD'
    r')\b', re.IGNORECASE)

_RE_CODEC_VIDEO = re.compile(
    r'\b('
    r'[xh][\.\s]?265|HEVC|'
    r'[xh][\.\s]?264|AVC|'
    r'AV1|VP9|MPEG[\s.\-]?2|XviD|DivX'
    r')\b', re.IGNORECASE)

_RE_CODEC_AUDIO = re.compile(
    r'\b('
    r'TrueHD[\s.\-]?Atmos|TrueHD|Atmos|'
    r'DTS[\s.\-]?HD[\s.\-]?MA|DTS[\s.\-]?HD|DTS[\s.\-]?X|DTS|'
    r'DD[\s.\-]?[Pp]lus|DDP?[\s.\-]?(?:5[\.\s]?1|7[\.\s]?1|2[\.\s]?0)?|DD[\s.\-]?(?:5[\.\s]?1|2[\.\s]?0)|'
    r'E[\s.\-]?AC[\s.\-]?3|EAC3|'
    r'AAC[\s.\-]?(?:2[\.\s]?0)?|AAC|'
    r'AC[\s.\-]?3|'
    r'FLAC|'
    r'LPCM|PCM|'
    r'MP3|OGG|Opus'
    r')\b', re.IGNORECASE)

_RE_AUDIO_CHANNELS = re.compile(
    r'\b(\d[\.\s]?\d)\s*(?:ch)?\b', re.IGNORECASE)

_RE_HDR = re.compile(
    r'\b('
    r'Dolby[\s.\-]?Vision|DV|'
    r'HDR10\+|HDR10Plus|HDR10|HDR|'
    r'HLG|'
    r'SDR'
    r')\b', re.IGNORECASE)

_RE_PROPER = re.compile(r'\b(PROPER|REPACK|RERIP|REAL)\b', re.IGNORECASE)

_RE_EDITION = re.compile(
    r'\b('
    r"(?:Director'?s?|Collector'?s?|Theatrical|Ultimate|Extended|Unrated|Uncut|"
    r'International|Special|Criterion|Despecialized|Final|Limited|Anniversary|Remastered)'
    r'[\s.\-]*(?:Cut|Edition|Version|Collection)?'
    r')\b', re.IGNORECASE)

_RE_RELEASE_GROUP = re.compile(r'-([A-Za-z0-9_]+)(?:\.[a-z]{2,4})?$')

_RE_BIT_DEPTH = re.compile(r'\b(10|8|12)[\s.\-]?bit\b', re.IGNORECASE)


def parse_release_name(release_name: str) -> dict:
    """
    Parse a release/download name and extract quality, codec, group, etc.

    Returns dict with keys:
        resolution, source, video_codec, audio_codec, audio_channels,
        hdr, modifier, edition, release_group, bit_depth
    """
    if not release_name:
        return {}

    result = {}

    m = _RE_RESOLUTION.search(release_name)
    if m:
        result['resolution'] = m.group(1).lower()

    m = _RE_SOURCE.search(release_name)
    if m:
        raw = m.group(1)
        result['source'] = _normalize_source(raw)

    m = _RE_CODEC_VIDEO.search(release_name)
    if m:
        result['video_codec'] = _normalize_video_codec(m.group(1))

    m = _RE_CODEC_AUDIO.search(release_name)
    if m:
        result['audio_codec'] = _normalize_audio_codec(m.group(1))

    m = _RE_AUDIO_CHANNELS.search(release_name)
    if m:
        ch = m.group(1).replace(' ', '.')
        if '.' not in ch and len(ch) == 2:
            ch = ch[0] + '.' + ch[1]
        result['audio_channels'] = ch

    m = _RE_HDR.search(release_name)
    if m:
        result['hdr'] = _normalize_hdr(m.group(1))

    m = _RE_PROPER.search(release_name)
    if m:
        result['modifier'] = m.group(1).capitalize()

    m = _RE_EDITION.search(release_name)
    if m:
        result['edition'] = m.group(1).strip()

    m = _RE_RELEASE_GROUP.search(release_name)
    if m:
        grp = m.group(1)
        if grp.upper() not in ('INTERNAL', 'SAMPLE', 'PROOF'):
            result['release_group'] = grp

    m = _RE_BIT_DEPTH.search(release_name)
    if m:
        result['bit_depth'] = m.group(1)

    return result


def _normalize_source(raw: str) -> str:
    low = raw.lower().replace(' ', '').replace('.', '').replace('-', '')
    if 'remux' in low:
        return 'Remux'
    if low in ('bluray', 'bdrip', 'brrip', 'bd', 'bdmv'):
        return 'BluRay'
    if low in ('webdl', 'web'):
        return 'WEBDL'
    if low == 'webrip':
        return 'WEBRip'
    if low == 'hdtv':
        return 'HDTV'
    if low in ('pdtv', 'sdtv'):
        return 'SDTV'
    if 'dvd' in low:
        return 'DVD'
    if 'hddvd' in low:
        return 'HDDVD'
    return raw


def _normalize_video_codec(raw: str) -> str:
    low = raw.lower().replace(' ', '').replace('.', '')
    if low in ('x265', 'h265', 'hevc'):
        return 'x265'
    if low in ('x264', 'h264', 'avc'):
        return 'x264'
    if low == 'av1':
        return 'AV1'
    if low == 'vp9':
        return 'VP9'
    if 'mpeg' in low:
        return 'MPEG2'
    if low in ('xvid', 'divx'):
        return 'XviD'
    return raw


def _normalize_audio_codec(raw: str) -> str:
    low = raw.lower().replace(' ', '').replace('.', '').replace('-', '')
    if 'truehd' in low and 'atmos' in low:
        return 'TrueHD Atmos'
    if 'truehd' in low:
        return 'TrueHD'
    if 'atmos' in low:
        return 'Atmos'
    if 'dtshd' in low and 'ma' in low:
        return 'DTS-HD MA'
    if 'dtshd' in low:
        return 'DTS-HD'
    if 'dtsx' in low:
        return 'DTS-X'
    if 'dts' in low:
        return 'DTS'
    if 'ddplus' in low or 'ddp' in low or 'eac3' in low:
        return 'EAC3'
    if 'dd' in low or 'ac3' in low:
        return 'AC3'
    if low == 'aac':
        return 'AAC'
    if low == 'flac':
        return 'FLAC'
    if 'lpcm' in low or 'pcm' in low:
        return 'LPCM'
    if low == 'mp3':
        return 'MP3'
    if low == 'opus':
        return 'Opus'
    return raw


def _normalize_hdr(raw: str) -> str:
    low = raw.lower().replace(' ', '').replace('.', '').replace('-', '')
    if 'dolbyvision' in low or low == 'dv':
        return 'DV'
    if 'hdr10plus' in low or 'hdr10+' in raw:
        return 'HDR10+'
    if 'hdr10' in low:
        return 'HDR10'
    if low == 'hdr':
        return 'HDR'
    if low == 'hlg':
        return 'HLG'
    return raw


# ── Quality Label Builder ─────────────────────────────────────────────────────

def build_quality_full(parsed: dict) -> str:
    """Build a Radarr/Sonarr-style quality string like 'WEBDL-1080p Proper'."""
    parts = []
    source = parsed.get('source', '')
    resolution = parsed.get('resolution', '')

    if source and resolution:
        parts.append(f"{source}-{resolution}")
    elif source:
        parts.append(source)
    elif resolution:
        parts.append(resolution)

    modifier = parsed.get('modifier', '')
    if modifier:
        parts.append(modifier)

    return ' '.join(parts) if parts else ''


def build_quality_title(parsed: dict) -> str:
    """Build quality without modifier, e.g. 'WEBDL-1080p'."""
    source = parsed.get('source', '')
    resolution = parsed.get('resolution', '')
    if source and resolution:
        return f"{source}-{resolution}"
    return source or resolution or ''


# ── Sanitisation ──────────────────────────────────────────────────────────────

_ILLEGAL_FILE_CHARS = r'<>"/\|?*'
_ILLEGAL_FOLDER_CHARS = r'<>"|?*'

_COLON_MODES = {
    'Smart Replace': lambda s: s.replace(': ', ' - ').replace(':', '-'),
    'Delete': lambda s: s.replace(':', ''),
    'Replace with Dash': lambda s: s.replace(':', '-'),
    'Replace with Space Dash': lambda s: s.replace(':', ' -'),
    'Replace with Space Dash Space': lambda s: s.replace(':', ' - '),
}


def sanitize_name(name: str, replace_illegal: bool = True,
                  colon_mode: str = 'Smart Replace',
                  is_folder: bool = False) -> str:
    """
    Clean a file or folder name: handle colons, illegal characters, and whitespace.
    Mirrors Radarr/Sonarr sanitisation behaviour.
    """
    if not name:
        return name

    colon_fn = _COLON_MODES.get(colon_mode, _COLON_MODES['Smart Replace'])
    name = colon_fn(name)

    illegal = _ILLEGAL_FOLDER_CHARS if is_folder else _ILLEGAL_FILE_CHARS
    if replace_illegal:
        replacements = {
            '<': '', '>': '', '"': '', '|': '', '?': '!', '*': '-',
            '\\': '+', '/': '+',
        }
        result = []
        for ch in name:
            if ch in illegal:
                result.append(replacements.get(ch, ''))
            else:
                result.append(ch)
        name = ''.join(result)
    else:
        name = ''.join(ch for ch in name if ch not in illegal)

    name = re.sub(r'\s+', ' ', name).strip()
    name = re.sub(r'\.{2,}', '.', name)
    name = name.strip('. ')
    return name


# ── Clean Title ───────────────────────────────────────────────────────────────

def clean_title(title: str) -> str:
    """Remove diacritics, apostrophes, and non-alphanumeric chars (like Radarr CleanTitle)."""
    if not title:
        return ''
    nfkd = unicodedata.normalize('NFKD', title)
    ascii_only = ''.join(c for c in nfkd if not unicodedata.combining(c))
    ascii_only = ascii_only.replace("'", '')
    ascii_only = re.sub(r'[^\w\s-]', '', ascii_only)
    return ascii_only.strip()


def title_the(title: str) -> str:
    """Move leading 'The' to end: 'The Matrix' -> 'Matrix, The'."""
    if not title:
        return ''
    if title.lower().startswith('the '):
        return title[4:] + ', The'
    return title


# ── Token Replacement Engine ──────────────────────────────────────────────────

_TOKEN_RE = re.compile(r'\{([^}]+)\}')

_BRACKET_TOKEN_RE = re.compile(
    r'\{(\[)([^]]*)\}|\{([^}]*?)(\])\}|\{(\[)([^]]*?)(\])\}'
)


def apply_format(format_string: str, token_values: dict) -> str:
    """
    Replace {Token Name} placeholders in a format string.

    Supports optional-bracket tokens like {[Quality Full]} where the brackets
    are only included if the token resolves to a non-empty value.

    Token lookup is case-insensitive.
    """
    if not format_string:
        return ''

    lower_map = {k.lower(): v for k, v in token_values.items()}

    def _replace_match(m):
        raw = m.group(1)
        prefix = ''
        suffix = ''
        token_name = raw

        if token_name.startswith('[') and token_name.endswith(']'):
            prefix = '['
            suffix = ']'
            token_name = token_name[1:-1]
        elif token_name.startswith('['):
            prefix = '['
            token_name = token_name[1:]
        elif token_name.endswith(']'):
            suffix = ']'
            token_name = token_name[:-1]

        token_name = token_name.strip()
        value = lower_map.get(token_name.lower(), '')

        if value:
            return f"{prefix}{value}{suffix}"
        return ''

    result = _TOKEN_RE.sub(_replace_match, format_string)

    result = re.sub(r'\s{2,}', ' ', result)
    result = re.sub(r'\[\s*\]', '', result)
    result = result.strip(' -.')
    return result


# ── Movie Token Builder ───────────────────────────────────────────────────────

def build_movie_tokens(title: str, year: str, collection_item: dict = None,
                       parsed_release: dict = None, probe_data: dict = None) -> dict:
    """
    Build a token-value dict for movie format strings.

    Merges data from: title/year, collection metadata, parsed release name, and probe data.
    """
    parsed = parsed_release or {}
    probe = probe_data or {}
    item = collection_item or {}

    quality_full = build_quality_full(parsed)
    quality_title = build_quality_title(parsed)

    video_codec = parsed.get('video_codec', '') or probe.get('video_codec', '')
    audio_codec = parsed.get('audio_codec', '') or probe.get('audio_codec', '')
    audio_channels = parsed.get('audio_channels', '') or probe.get('audio_layout', '')
    hdr = parsed.get('hdr', '') or ''
    bit_depth = parsed.get('bit_depth', '') or probe.get('video_bit_depth', '')

    release_group = parsed.get('release_group', '')
    edition = parsed.get('edition', '')

    tmdb_id = str(item.get('tmdb_id', ''))
    imdb_id = str(item.get('imdb_id', ''))

    tokens = {
        'Movie Title': title or '',
        'Movie CleanTitle': clean_title(title or ''),
        'Movie TitleThe': title_the(title or ''),
        'Movie CleanTitleThe': title_the(clean_title(title or '')),
        'Movie TitleFirstCharacter': (title or ' ')[0].upper() if title else '',
        'Release Year': year or '',
        'Quality Full': quality_full,
        'Quality Title': quality_title,
        'MediaInfo VideoCodec': video_codec,
        'MediaInfo VideoBitDepth': str(bit_depth) if bit_depth else '',
        'MediaInfo VideoDynamicRange': hdr,
        'MediaInfo VideoDynamicRangeType': hdr,
        'MediaInfo AudioCodec': audio_codec,
        'MediaInfo AudioChannels': audio_channels,
        'MediaInfo Simple': ' '.join(filter(None, [video_codec, audio_codec])),
        'MediaInfo Full': ' '.join(filter(None, [video_codec, audio_codec,
                                                  f'[{audio_channels}]' if audio_channels else ''])),
        'Release Group': release_group,
        'Edition Tags': edition,
        'ImdbId': imdb_id,
        'TmdbId': tmdb_id,
        'Original Title': '',
        'Original Filename': '',
    }
    return tokens


# ── TV Episode Token Builder ──────────────────────────────────────────────────

def build_tv_tokens(series_title: str, year: str, season: int, episode: int,
                    episode_title: str = '', absolute_episode: int = None,
                    air_date: str = '', series_item: dict = None,
                    parsed_release: dict = None, probe_data: dict = None) -> dict:
    """
    Build a token-value dict for TV episode format strings.
    """
    parsed = parsed_release or {}
    probe = probe_data or {}
    item = series_item or {}

    quality_full = build_quality_full(parsed)
    quality_title = build_quality_title(parsed)

    video_codec = parsed.get('video_codec', '') or probe.get('video_codec', '')
    audio_codec = parsed.get('audio_codec', '') or probe.get('audio_codec', '')
    audio_channels = parsed.get('audio_channels', '') or probe.get('audio_layout', '')
    hdr = parsed.get('hdr', '') or ''
    bit_depth = parsed.get('bit_depth', '') or probe.get('video_bit_depth', '')

    release_group = parsed.get('release_group', '')

    title_year = f"{series_title} ({year})" if year else series_title

    tokens = {
        'Series Title': series_title or '',
        'Series CleanTitle': clean_title(series_title or ''),
        'Series TitleYear': title_year,
        'Series CleanTitleYear': clean_title(title_year),
        'Series TitleWithoutYear': series_title or '',
        'Series CleanTitleWithoutYear': clean_title(series_title or ''),
        'Series TitleThe': title_the(series_title or ''),
        'Series CleanTitleThe': title_the(clean_title(series_title or '')),
        'Series TitleTheYear': f"{title_the(series_title or '')} ({year})" if year else title_the(series_title or ''),
        'Series CleanTitleTheYear': clean_title(f"{title_the(series_title or '')} ({year})" if year else title_the(series_title or '')),
        'Series TitleFirstCharacter': (series_title or ' ')[0].upper() if series_title else '',
        'Series Year': year or '',

        'season:0': str(season) if season is not None else '0',
        'season:00': str(season).zfill(2) if season is not None else '00',

        'episode:0': str(episode) if episode is not None else '0',
        'episode:00': str(episode).zfill(2) if episode is not None else '00',

        'absolute:0': str(absolute_episode) if absolute_episode is not None else '',
        'absolute:00': str(absolute_episode).zfill(2) if absolute_episode is not None else '',
        'absolute:000': str(absolute_episode).zfill(3) if absolute_episode is not None else '',

        'Episode Title': episode_title or '',
        'Episode CleanTitle': clean_title(episode_title or ''),

        'Air-Date': air_date or '',
        'Air Date': (air_date or '').replace('-', ' '),

        'Quality Full': quality_full,
        'Quality Title': quality_title,

        'MediaInfo Simple': ' '.join(filter(None, [video_codec, audio_codec])),
        'MediaInfo Full': ' '.join(filter(None, [video_codec, audio_codec,
                                                  f'[{audio_channels}]' if audio_channels else ''])),
        'MediaInfo VideoCodec': video_codec,
        'MediaInfo VideoBitDepth': str(bit_depth) if bit_depth else '',
        'MediaInfo VideoDynamicRange': hdr,
        'MediaInfo VideoDynamicRangeType': hdr,
        'MediaInfo AudioCodec': audio_codec,
        'MediaInfo AudioChannels': audio_channels,
        'MediaInfo AudioLanguages': '',
        'MediaInfo AudioLanguagesAll': '',
        'MediaInfo SubtitleLanguages': '',

        'Release Group': release_group,
        'Release Hash': '',
        'Custom Formats': '',

        'ImdbId': str(item.get('imdb_id', '')),
        'TvdbId': str(item.get('tvdb_id', '')),
        'TmdbId': str(item.get('tmdb_id', '')),
        'TvMazeId': str(item.get('tvmaze_id', '')),

        'Original Title': '',
        'Original Filename': '',
    }
    return tokens


# ── High-level helpers for importers ──────────────────────────────────────────

def get_movie_management_config(instance_id: int) -> dict:
    """Read movie management config from the database (same source as the settings UI)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('movie_management', instance_id)
        defaults = {
            'rename_movies': True, 'replace_illegal_characters': True,
            'colon_replacement': 'Smart Replace',
            'standard_movie_format': '{Movie Title} ({Release Year}) {Quality Full}',
            'movie_folder_format': '{Movie Title} ({Release Year})',
            'minimum_free_space_gb': 10,
        }
        if not config or not isinstance(config, dict):
            return dict(defaults)
        out = dict(defaults)
        for k, v in config.items():
            if k in out:
                out[k] = v
        return out
    except Exception:
        return {
            'rename_movies': True, 'replace_illegal_characters': True,
            'colon_replacement': 'Smart Replace',
            'standard_movie_format': '{Movie Title} ({Release Year}) {Quality Full}',
            'movie_folder_format': '{Movie Title} ({Release Year})',
            'minimum_free_space_gb': 10,
        }


def get_tv_management_config(instance_id: int) -> dict:
    """Read TV management config from the database (same source as the settings UI)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_management', instance_id)
        defaults = {
            'rename_episodes': True, 'replace_illegal_characters': True,
            'colon_replacement': 'Smart Replace',
            'standard_episode_format': "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}",
            'daily_episode_format': "{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {Quality Full}",
            'anime_episode_format': "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {Quality Full}",
            'series_folder_format': '{Series TitleYear}',
            'season_folder_format': 'Season {season:00}',
            'specials_folder_format': 'Specials',
            'multi_episode_style': 'Prefixed Range',
            'minimum_free_space_gb': 10,
        }
        if not config or not isinstance(config, dict):
            return dict(defaults)
        out = dict(defaults)
        for k, v in config.items():
            if k in out:
                out[k] = v
        return out
    except Exception:
        return {
            'rename_episodes': True, 'replace_illegal_characters': True,
            'colon_replacement': 'Smart Replace',
            'standard_episode_format': "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}",
            'daily_episode_format': "{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {Quality Full}",
            'anime_episode_format': "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {Quality Full}",
            'series_folder_format': '{Series TitleYear}',
            'season_folder_format': 'Season {season:00}',
            'specials_folder_format': 'Specials',
            'multi_episode_style': 'Prefixed Range',
            'minimum_free_space_gb': 10,
        }


def format_movie_filename(title: str, year: str, ext: str,
                          collection_item: dict = None,
                          release_name: str = '',
                          probe_data: dict = None,
                          instance_id: int = None) -> tuple:
    """
    Generate (folder_name, file_name) for a movie import using the user's format settings.

    Returns:
        (folder_name: str, file_name_with_ext: str)
    """
    config = get_movie_management_config(instance_id)
    rename = config.get('rename_movies', True)
    replace_illegal = config.get('replace_illegal_characters', True)
    colon_mode = config.get('colon_replacement', 'Smart Replace')

    parsed = parse_release_name(release_name) if release_name else {}
    tokens = build_movie_tokens(title, year, collection_item, parsed, probe_data)

    if rename:
        folder_fmt = config.get('movie_folder_format', '{Movie Title} ({Release Year})')
        file_fmt = config.get('standard_movie_format', '{Movie Title} ({Release Year}) {Quality Full}')

        folder_name = apply_format(folder_fmt, tokens)
        file_name = apply_format(file_fmt, tokens)
    else:
        folder_name = f"{title} ({year})" if year else title
        file_name = f"{title} ({year})" if year else title

    folder_name = sanitize_name(folder_name, replace_illegal, colon_mode, is_folder=True)
    file_name = sanitize_name(file_name, replace_illegal, colon_mode, is_folder=False)

    if not folder_name:
        folder_name = f"{title} ({year})" if year else (title or 'Unknown')
    if not file_name:
        file_name = f"{title} ({year})" if year else (title or 'Unknown')

    return folder_name, file_name + ext


def format_episode_filename(series_title: str, year: str, season: int, episode: int,
                            episode_title: str = '', ext: str = '.mkv',
                            absolute_episode: int = None, air_date: str = '',
                            series_type: str = 'standard',
                            series_item: dict = None,
                            release_name: str = '',
                            probe_data: dict = None,
                            instance_id: int = None) -> tuple:
    """
    Generate (series_folder, season_folder, file_name) for a TV episode import.

    Returns:
        (series_folder: str, season_folder: str, file_name_with_ext: str)
    """
    config = get_tv_management_config(instance_id)
    rename = config.get('rename_episodes', True)
    replace_illegal = config.get('replace_illegal_characters', True)
    colon_mode = config.get('colon_replacement', 'Smart Replace')

    parsed = parse_release_name(release_name) if release_name else {}
    tokens = build_tv_tokens(
        series_title, year, season, episode,
        episode_title=episode_title,
        absolute_episode=absolute_episode,
        air_date=air_date,
        series_item=series_item,
        parsed_release=parsed,
        probe_data=probe_data,
    )

    if rename:
        series_folder_fmt = config.get('series_folder_format', '{Series TitleYear}')
        if season == 0:
            season_folder_fmt = config.get('specials_folder_format', 'Specials')
        else:
            season_folder_fmt = config.get('season_folder_format', 'Season {season:00}')

        if series_type == 'daily':
            file_fmt = config.get('daily_episode_format',
                                  "{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {Quality Full}")
        elif series_type == 'anime':
            file_fmt = config.get('anime_episode_format',
                                  "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {Quality Full}")
        else:
            file_fmt = config.get('standard_episode_format',
                                  "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}")

        series_folder = apply_format(series_folder_fmt, tokens)
        season_folder = apply_format(season_folder_fmt, tokens)
        file_name = apply_format(file_fmt, tokens)
    else:
        series_folder = f"{series_title} ({year})" if year else series_title
        season_folder = f"Season {str(season).zfill(2)}" if season is not None else 'Season 01'
        file_name = f"{series_title} - S{str(season).zfill(2)}E{str(episode).zfill(2)}"
        if episode_title:
            file_name += f" - {episode_title}"

    series_folder = sanitize_name(series_folder, replace_illegal, colon_mode, is_folder=True)
    season_folder = sanitize_name(season_folder, replace_illegal, colon_mode, is_folder=True)
    file_name = sanitize_name(file_name, replace_illegal, colon_mode, is_folder=False)

    if not series_folder:
        series_folder = series_title or 'Unknown Series'
    if not season_folder:
        season_folder = f"Season {str(season).zfill(2)}" if season is not None else 'Season 01'
    if not file_name:
        file_name = f"{series_title} - S{str(season).zfill(2)}E{str(episode).zfill(2)}"

    return series_folder, season_folder, file_name + ext
