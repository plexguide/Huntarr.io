# Sonarr File Naming Analysis - Python Implementation Guide

## Core Data Objects Available During Import

### Series Object
```python
{
    "Title": str,              # Full series title
    "Year": int,               # Year (0 if unknown)
    "SeriesType": str,         # "Standard", "Daily", or "Anime"
    "Path": str,               # Root series folder path
    "SeasonFolder": bool,      # Whether to use season folders
    "TmdbId": int,
    "TvdbId": int,
    "ImdbId": str,
    "TvMazeId": int
}
```

### Episode Object (List)
```python
{
    "SeasonNumber": int,           # Season number (0 for specials)
    "EpisodeNumber": int,          # Episode number within season
    "AbsoluteEpisodeNumber": int?, # Absolute episode number (anime, nullable)
    "AirDate": str?,               # Format: "YYYY-MM-DD" (nullable)
    "Title": str                   # Episode title
}
```

### EpisodeFile Object
```python
{
    "ReleaseGroup": str?,          # Release group name (nullable)
    "ReleaseHash": str?,           # Release hash (nullable)
    "Quality": QualityObject,      # Quality info
    "MediaInfo": MediaInfoObject?, # MediaInfo data (nullable)
    "Id": int                      # 0 if new file, >0 if existing
}
```

## Episode-Specific Tokens

### Season/Episode Numbering
- **`{season:00}`** - Season number with zero-padding (e.g., `:00` = `01`, `:000` = `001`)
- **`{episode:00}`** - Episode number with zero-padding
- **`{Season Episode}`** - Combined pattern like `S01E01` (auto-detected from format)
- **`{Episode}`** - Single episode number, or `01-03` for multi-episodes

**Implementation Pattern:**
```python
# Token format: {season:00} or {season:000}
# Extract padding from token: ":00" = 2 digits, ":000" = 3 digits
season_str = f"{season_number:0{padding}d}"

# Multi-episode: {Episode} becomes "01-03" for episodes 1-3
if len(episodes) > 1:
    episode_str = f"{episodes[0].EpisodeNumber:0{padding}d}-{episodes[-1].EpisodeNumber:0{padding}d}"
else:
    episode_str = f"{episodes[0].EpisodeNumber:0{padding}d}"
```

### Absolute Episode Numbering (Anime)
- **`{absolute:000}`** - Absolute episode number with zero-padding
- Only used when `SeriesType == "Anime"` AND all episodes have `AbsoluteEpisodeNumber`

### Episode Title
- **`{Episode Title}`** - Raw episode titles joined with "+"
- **`{Episode CleanTitle}`** - Cleaned titles joined with "and"
- Titles are truncated to fit within max path length
- Multi-episode: joins all episode titles

**Title Cleaning Rules:**
- Remove diacritics (é → e)
- Replace `&` with `and`
- Remove special chars: `,`, `<`, `>`, `/`, `\`, `;`, `:`, `'`, `"`, `|`, `` ` ``, `~`, `!`, `?`, `@`, `$`, `%`, `^`, `*`
- Remove trailing `: Part 1`, `(1)`, `Pt. 1` patterns

### Air Date
- **`{Air Date}`** - Format: `YYYY MM DD` (spaces, not dashes)
- Falls back to `"Unknown"` if `AirDate` is null/empty
- Example: `2024-01-15` → `"2024 01 15"`

## Series Title Tokens

All series tokens support truncation via `:N` suffix (e.g., `{Series Title:20}`)

- **`{Series Title}`** - Raw title
- **`{Series CleanTitle}`** - Cleaned (diacritics removed, special chars removed)
- **`{Series TitleYear}`** - Title with `(YYYY)` appended if year > 0
- **`{Series CleanTitleYear}`** - Cleaned title + year
- **`{Series TitleWithoutYear}`** - Title with year removed if present
- **`{Series TitleThe}`** - "The Show" → "Show, The"
- **`{Series CleanTitleThe}`** - Cleaned + "The" moved
- **`{Series Year}`** - Just the year number

## Season/Series Folder Tokens

### Series Folder Format
Uses same series tokens (`{Series Title}`, `{Series CleanTitle}`, etc.) plus ID tokens:
- `{ImdbId}`, `{TvdbId}`, `{TmdbId}`, `{TvMazeId}`

### Season Folder Format
- **`{season:00}`** - Season number with padding
- Uses `SpecialsFolderFormat` for season 0, `SeasonFolderFormat` otherwise
- Same series tokens available

**Folder Cleaning:**
- Replace consecutive separators (`-`, `.`, `_`, ` `) with single separator
- Trim trailing separators and spaces
- Replace reserved Windows device names (`aux`, `con`, `nul`, etc.)

## Multi-Episode Naming Styles

Sonarr supports 6 multi-episode styles for `S01E01-E03` patterns:

### 1. Extend (Default)
- **Pattern**: `S01E01-E03`
- First and last episode numbers with dash
- Example: `S01E01-E03`

### 2. Duplicate
- **Pattern**: `S01E01 S01E02 S01E03`
- Repeats full season+episode pattern for each episode
- Example: `S01E01 S01E02 S01E03`

### 3. Repeat
- **Pattern**: `S01E01 E02 E03`
- Season once, then episode numbers
- Example: `S01E01 E02 E03`

### 4. Scene
- **Pattern**: `S01E01-E02-E03`
- Dash-separated episode numbers
- Example: `S01E01-E02-E03`

### 5. Range
- **Pattern**: `S01E01-03`
- First episode, then dash, then last episode number (no padding on last)
- Example: `S01E01-03`

### 6. PrefixedRange
- **Pattern**: `S01E01-E03`
- First episode, dash, then last episode with separator
- Example: `S01E01-E03`

**Python Implementation:**
```python
def format_multi_episode(episodes, style, season_pattern, episode_pattern, separator):
    first = episodes[0]
    last = episodes[-1]
    
    if style == "Extend":
        return f"{season_pattern}{separator}{episode_pattern}".replace(
            "{episode}", f"{first.EpisodeNumber:02d}-{last.EpisodeNumber:02d}"
        )
    elif style == "Range":
        # Only pad first episode
        return f"{season_pattern}{separator}{episode_pattern}".replace(
            "{episode}", f"{first.EpisodeNumber:02d}-{last.EpisodeNumber}"
        )
    # ... other styles
```

## Token Replacement Flow

1. **Parse pattern** - Split by `/` or `\` for path segments
2. **Detect episode patterns** - Find `{season:00}...{episode:00}` patterns via regex
3. **Add numbering tokens** - Replace detected patterns with placeholders, build multi-episode strings
4. **Add series tokens** - Map all `{Series *}` tokens
5. **Add episode tokens** - Map `{Air Date}`, `{Episode Title}` placeholders
6. **Add file tokens** - `{Original Title}`, `{Release Group}`, etc.
7. **Calculate max length** - Subtract fixed parts from path limit
8. **Add episode titles** - Truncate titles to fit remaining space
9. **Replace tokens** - Process all tokens with custom formats/truncation
10. **Clean filename** - Remove duplicate separators, trim, replace reserved names

## Key Regex Patterns

```python
# Detect season/episode pattern: S01E01, s01e01, 01x01, etc.
SEASON_EPISODE_PATTERN = r"(?<=})[- ._]+?)?(s?{season(?::0+)?}([- ._]?[ex]){episode(?::0+)?})([- ._]+?(?={))?"

# Detect absolute episode: {absolute:000}
ABSOLUTE_EPISODE_PATTERN = r"\{absolute(?::0+)?\}"

# Extract token with format: {token:format}
TOKEN_PATTERN = r"\{([- ._\[(]*)([a-z0-9]+(?:[- ._]+[a-z0-9]+)?)(?::([ ,a-z0-9+-]+([- ._)\]]*)))?\}"
```

## Practical Python Implementation Notes

1. **Token Parsing**: Use regex to extract token name and format specifier (`:00`, `:20`, etc.)
2. **Padding**: Extract digit count from format (`:00` = 2, `:000` = 3)
3. **Truncation**: `:N` suffix truncates to N characters
4. **Multi-episode**: Sort episodes by SeasonNumber then EpisodeNumber before processing
5. **Path Length**: Windows max is 260 chars (or 32K with long path support). Calculate remaining space after folder path.
6. **Title Truncation**: Calculate `max_title_length = max_path - (filename_length - title_length)`, then truncate titles to fit.
7. **Separator Cleanup**: Replace `([- ._])\1+` with single separator, trim trailing separators.
8. **Reserved Names**: Check for Windows reserved device names and replace (e.g., `aux.txt` → `_aux.txt`).
