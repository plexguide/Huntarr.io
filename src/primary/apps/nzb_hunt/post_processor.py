"""
NZB Hunt Post-Processor - Handles extraction and cleanup after download.

Post-processing pipeline:
  1. Deobfuscate filenames (detect archive type by magic bytes, rename)
  2. par2 verification and repair (if par2 files exist)
  3. RAR extraction (if RAR files exist)
  4. Cleanup of source archives and par2 files
  5. Final file placement

Requires system packages: unrar (RARLAB), par2, p7zip-full
"""

import os
import re
import glob
import shutil
import struct
import subprocess
from typing import Optional, Tuple, List, Dict

from src.primary.utils.logger import get_logger

logger = get_logger("nzb_hunt.postprocess")


# ── Magic-byte signatures for archive detection ──────────────────
# Read only the first 16 bytes of each file to identify format.
# This is how real downloaders detect obfuscated archives.

_RAR4_MAGIC = b'Rar!\x1a\x07\x00'       # RAR v1.5–4
_RAR5_MAGIC = b'Rar!\x1a\x07\x01\x00'   # RAR v5+
_7Z_MAGIC   = b'7z\xbc\xaf\x27\x1c'     # 7-Zip
_ZIP_MAGIC  = b'PK\x03\x04'             # ZIP (local file header)
_PAR2_MAGIC = b'PAR2\x00PKT'            # par2


def _detect_file_type(filepath: str) -> Optional[str]:
    """Detect archive type by reading magic bytes from file header.
    
    Returns: 'rar', '7z', 'zip', 'par2', or None if not an archive.
    """
    try:
        with open(filepath, 'rb') as f:
            header = f.read(16)
    except (IOError, OSError):
        return None

    if len(header) < 4:
        return None

    if header[:8] == _RAR5_MAGIC or header[:7] == _RAR4_MAGIC:
        return 'rar'
    if header[:6] == _7Z_MAGIC:
        return '7z'
    if header[:4] == _ZIP_MAGIC:
        return 'zip'
    if header[:8] == _PAR2_MAGIC:
        return 'par2'

    return None


# ── Deobfuscation ────────────────────────────────────────────────

def _deobfuscate_files(directory: str) -> int:
    """Detect and rename obfuscated archive files by magic bytes.
    
    Usenet posts commonly use randomized filenames without extensions.
    This scans every file that lacks a recognized archive extension,
    reads its magic bytes, and renames it to a proper extension so
    that unrar/7z can find all volumes in a multi-part set.
    
    Returns: number of files renamed.
    """
    known_exts = {
        '.rar', '.zip', '.7z', '.par2',
        '.r00', '.r01', '.r02', '.r03', '.r04', '.r05',
        '.r06', '.r07', '.r08', '.r09',
        '.nfo', '.sfv', '.srr', '.srs', '.nzb',
        '.mkv', '.mp4', '.avi', '.wmv', '.m4v', '.mov',
        '.ts', '.mpg', '.mpeg', '.srt', '.sub', '.idx',
        '.txt', '.jpg', '.jpeg', '.png',
    }
    # Also known: old-style .rXX, .sXX, .partXX.rar, .volXXX+XX.par2
    old_style_re = re.compile(r'\.[rs]\d{2,3}$', re.IGNORECASE)
    part_rar_re = re.compile(r'\.part\d+\.rar$', re.IGNORECASE)
    vol_par2_re = re.compile(r'\.vol\d+.*\.par2$', re.IGNORECASE)

    renamed = 0
    rar_counter = 0  # For generating sequential .rar / .rNN names

    # First pass: collect files that need identification
    files_to_check = []
    for fname in sorted(os.listdir(directory)):
        fpath = os.path.join(directory, fname)
        if not os.path.isfile(fpath):
            continue

        ext = os.path.splitext(fname)[1].lower()
        fl = fname.lower()

        # Skip files that already have recognized extensions
        if ext in known_exts:
            continue
        if old_style_re.search(fl):
            continue
        if part_rar_re.search(fl):
            continue
        if vol_par2_re.search(fl):
            continue

        # Skip very small files (< 1KB) — likely metadata
        try:
            if os.path.getsize(fpath) < 1024:
                continue
        except OSError:
            continue

        files_to_check.append(fpath)

    if not files_to_check:
        return 0

    # Second pass: detect type by magic bytes and rename
    # Group RAR files together so we can generate sequential names
    rar_files_to_rename = []
    other_renames = []

    for fpath in files_to_check:
        ftype = _detect_file_type(fpath)
        if ftype == 'rar':
            rar_files_to_rename.append(fpath)
        elif ftype == '7z':
            other_renames.append((fpath, '.7z'))
        elif ftype == 'zip':
            other_renames.append((fpath, '.zip'))
        elif ftype == 'par2':
            other_renames.append((fpath, '.par2'))

    # Rename RAR files with sequential naming so unrar can find volumes
    # Sort by file size descending, then name — largest files first
    # (all volumes are typically the same size, first volume has RAR header)
    if rar_files_to_rename:
        # Sort alphabetically (Usenet obfuscated names are usually in order)
        rar_files_to_rename.sort()
        
        # Find the base name from existing proper RAR files (if any)
        existing_rars = _find_rar_files(directory)
        if existing_rars:
            # Use the same base name as existing RAR files
            base = os.path.splitext(os.path.basename(existing_rars[0]))[0]
            # Remove .partXX if present
            base = re.sub(r'\.part\d+$', '', base, flags=re.IGNORECASE)
        else:
            # Use directory name as base
            base = os.path.basename(directory)

        for i, fpath in enumerate(rar_files_to_rename):
            if i == 0 and not existing_rars:
                new_ext = '.rar'
            else:
                # Generate .r00, .r01, ... .r99, then .s00, ...
                vol_idx = i - 1 + len([f for f in existing_rars 
                                       if not f.lower().endswith('.rar') or 
                                       '.part' in f.lower()])
                if vol_idx < 0:
                    vol_idx = 0
                if vol_idx <= 99:
                    new_ext = f'.r{vol_idx:02d}'
                else:
                    new_ext = f'.s{vol_idx - 100:02d}'

            new_name = base + new_ext
            new_path = os.path.join(directory, new_name)

            # Avoid collisions
            collision = 0
            while os.path.exists(new_path):
                collision += 1
                new_name = f"{base}_{collision}{new_ext}"
                new_path = os.path.join(directory, new_name)

            try:
                os.rename(fpath, new_path)
                renamed += 1
                logger.info(f"Deobfuscated: {os.path.basename(fpath)} -> {new_name}")
            except OSError as e:
                logger.warning(f"Failed to rename {os.path.basename(fpath)}: {e}")

    # Rename other archive types
    for fpath, new_ext in other_renames:
        old_name = os.path.basename(fpath)
        new_name = os.path.splitext(old_name)[0] + new_ext
        new_path = os.path.join(directory, new_name)
        if os.path.exists(new_path):
            new_name = old_name + new_ext
            new_path = os.path.join(directory, new_name)
        try:
            os.rename(fpath, new_path)
            renamed += 1
            logger.info(f"Deobfuscated: {old_name} -> {new_name}")
        except OSError as e:
            logger.warning(f"Failed to rename {old_name}: {e}")

    if renamed > 0:
        logger.info(f"Deobfuscation renamed {renamed} files")
    return renamed


# ── File detection helpers ────────────────────────────────────────

def _find_par2_files(directory: str) -> List[str]:
    """Find all par2 files in a directory."""
    par2_files = []
    for f in os.listdir(directory):
        if f.lower().endswith('.par2'):
            par2_files.append(os.path.join(directory, f))
    return sorted(par2_files)


def _find_main_par2(par2_files: List[str]) -> Optional[str]:
    """Find the main (smallest/index) par2 file.
    
    The main par2 file is the one without 'vol' in the name,
    or the smallest one if all have 'vol'.
    """
    if not par2_files:
        return None
    
    # Look for the index par2 (no 'vol' in name)
    for f in par2_files:
        basename = os.path.basename(f).lower()
        if '.vol' not in basename:
            return f
    
    # Fall back to smallest file
    return min(par2_files, key=os.path.getsize)


def _find_rar_files(directory: str) -> List[str]:
    """Find RAR archive files in a directory.
    
    Handles multiple naming conventions:
    - .rar, .part01.rar, .part001.rar (modern)
    - .r00, .r01, .r02 (old style)
    - .s00, .s01 (split files)
    """
    rar_files = []
    for f in os.listdir(directory):
        fl = f.lower()
        if fl.endswith('.rar'):
            rar_files.append(os.path.join(directory, f))
        elif re.match(r'.*\.[rs]\d{2,3}$', fl):
            rar_files.append(os.path.join(directory, f))
    return sorted(rar_files)


def _find_first_rar(rar_files: List[str]) -> Optional[str]:
    """Find the first RAR file to extract from.
    
    This is the file that unrar should be pointed at:
    - .part01.rar or .part001.rar (multi-part)
    - .rar (single or first of old-style set)
    
    Falls back to detecting by magic bytes — the first volume
    always starts with the RAR signature.
    """
    if not rar_files:
        return None
    
    # Look for part01.rar or part001.rar
    for f in rar_files:
        basename = os.path.basename(f).lower()
        if re.search(r'\.part0*1\.rar$', basename):
            return f
    
    # Look for plain .rar (not .partXX.rar)
    for f in rar_files:
        basename = os.path.basename(f).lower()
        if basename.endswith('.rar') and '.part' not in basename:
            return f
    
    # Detect by magic bytes — the first volume has the archive header
    for f in rar_files:
        ftype = _detect_file_type(f)
        if ftype == 'rar':
            return f
    
    # Fall back to first file alphabetically
    return rar_files[0]


def _find_zip_files(directory: str) -> List[str]:
    """Find ZIP archive files in a directory."""
    return sorted([
        os.path.join(directory, f)
        for f in os.listdir(directory)
        if f.lower().endswith('.zip')
    ])


def _find_7z_files(directory: str) -> List[str]:
    """Find 7z archive files in a directory."""
    return sorted([
        os.path.join(directory, f)
        for f in os.listdir(directory)
        if f.lower().endswith('.7z')
    ])


def _has_video_files(directory: str) -> bool:
    """Check if directory already contains video files (no extraction needed)."""
    video_exts = {'.mkv', '.mp4', '.avi', '.wmv', '.m4v', '.mov', '.ts', '.mpg', '.mpeg'}
    for f in os.listdir(directory):
        ext = os.path.splitext(f)[1].lower()
        if ext in video_exts:
            fpath = os.path.join(directory, f)
            if os.path.isfile(fpath) and os.path.getsize(fpath) > 1024:
                return True
    return False


# ── par2 verification and repair ─────────────────────────────────

def run_par2_repair(directory: str) -> Tuple[bool, str]:
    """Run par2 verification and repair on a directory.
    
    Returns:
        (success: bool, message: str)
    """
    par2_files = _find_par2_files(directory)
    if not par2_files:
        return True, "No par2 files found, skipping verification"
    
    main_par2 = _find_main_par2(par2_files)
    if not main_par2:
        return True, "No main par2 file found, skipping verification"
    
    logger.info(f"Running par2 verification: {os.path.basename(main_par2)}")
    
    try:
        result = subprocess.run(
            ["par2", "verify", main_par2],
            cwd=directory,
            capture_output=True,
            text=True,
            timeout=3600
        )
        
        if result.returncode == 0:
            logger.info("par2 verification passed - all files intact")
            return True, "par2 verification passed"
        
        combined_output = (result.stdout or '') + (result.stderr or '')
        if 'main packet not found' in combined_output.lower():
            logger.info("par2: no main packet in par2 files (volume-only set), skipping verification")
            return True, "par2 skipped (volume-only set, no index file)"
        
        logger.warning(f"par2 verification failed (rc={result.returncode}), attempting repair...")
        
        result = subprocess.run(
            ["par2", "repair", main_par2],
            cwd=directory,
            capture_output=True,
            text=True,
            timeout=7200
        )
        
        if result.returncode == 0:
            logger.info("par2 repair successful")
            return True, "par2 repair successful"
        else:
            msg = (result.stderr or result.stdout or '')[:500]
            logger.error(f"par2 repair failed (rc={result.returncode}): {msg}")
            return False, f"par2 repair failed: {msg[:200]}"
            
    except FileNotFoundError:
        logger.warning("par2 command not found, skipping verification")
        return True, "par2 not available, skipping"
    except subprocess.TimeoutExpired:
        logger.warning("par2 operation timed out, continuing anyway")
        return True, "par2 timed out, skipping"
    except Exception as e:
        logger.warning(f"par2 error (non-fatal): {e}")
        return True, f"par2 skipped: {e}"


# ── Archive extraction ───────────────────────────────────────────

def extract_archives(directory: str) -> Tuple[bool, str]:
    """Extract archives in a directory (RAR, ZIP, 7z).
    
    Returns:
        (success: bool, message: str)
    """
    extracted_something = False
    
    # Try RAR extraction first (most common for Usenet)
    rar_files = _find_rar_files(directory)
    if rar_files:
        first_rar = _find_first_rar(rar_files)
        if first_rar:
            success, msg = _extract_rar(first_rar, directory)
            if not success:
                return False, msg
            extracted_something = True
    
    # Try ZIP extraction
    zip_files = _find_zip_files(directory)
    for zf in zip_files:
        success, msg = _extract_zip(zf, directory)
        if not success:
            logger.warning(f"ZIP extraction failed for {os.path.basename(zf)}: {msg}")
        else:
            extracted_something = True
    
    # Try 7z extraction
    sevenz_files = _find_7z_files(directory)
    for sf in sevenz_files:
        success, msg = _extract_7z(sf, directory)
        if not success:
            logger.warning(f"7z extraction failed for {os.path.basename(sf)}: {msg}")
        else:
            extracted_something = True
    
    if not extracted_something:
        if _has_video_files(directory):
            return True, "No archives to extract, video files already present"
        return True, "No archives found to extract"
    
    return True, "Extraction completed successfully"


def _extract_rar(rar_path: str, output_dir: str) -> Tuple[bool, str]:
    """Extract a RAR archive.
    
    Tries unrar first (preferred, supports RAR5), then 7z as fallback.
    Captures the real error from unrar so we don't just report a
    misleading 7z fallback error.
    """
    basename = os.path.basename(rar_path)
    logger.info(f"Extracting RAR: {basename} -> {output_dir}")
    
    last_unrar_error = ""
    
    # Try unrar first (supports RAR5 format)
    for unrar_cmd in ["unrar", "unrar-free"]:
        try:
            result = subprocess.run(
                [unrar_cmd, "x", "-o+", "-y", rar_path, output_dir + "/"],
                capture_output=True,
                text=True,
                timeout=7200
            )
            
            if result.returncode == 0:
                logger.info(f"RAR extraction successful with {unrar_cmd}")
                return True, f"Extracted with {unrar_cmd}"
            else:
                combined = ((result.stdout or '') + '\n' + (result.stderr or '')).strip()
                last_unrar_error = combined[:500]
                logger.warning(f"{unrar_cmd} failed (rc={result.returncode}): "
                             f"{combined[:500]}")
        except FileNotFoundError:
            logger.debug(f"{unrar_cmd} not found, trying next")
            continue
        except subprocess.TimeoutExpired:
            logger.error(f"RAR extraction timed out with {unrar_cmd}")
            return False, "Extraction timed out"
        except Exception as e:
            logger.warning(f"{unrar_cmd} error: {e}")
            continue
    
    # Fallback to 7z
    try:
        result = subprocess.run(
            ["7z", "x", "-y", f"-o{output_dir}", rar_path],
            capture_output=True,
            text=True,
            timeout=7200
        )
        
        if result.returncode == 0:
            logger.info("RAR extraction successful with 7z")
            return True, "Extracted with 7z"
        else:
            combined = ((result.stdout or '') + '\n' + (result.stderr or '')).strip()
            logger.error(f"7z extraction also failed (rc={result.returncode}): {combined[:500]}")

            # Report the real unrar error if available, not the 7z fallback noise
            if last_unrar_error:
                return False, _clean_extraction_error(last_unrar_error)
            return False, _clean_extraction_error(combined[:500])
    except FileNotFoundError:
        if last_unrar_error:
            return False, _clean_extraction_error(last_unrar_error)
        logger.error("No RAR extraction tool found (tried unrar, unrar-free, 7z)")
        return False, "No extraction tool available"
    except subprocess.TimeoutExpired:
        return False, "Extraction timed out"
    except Exception as e:
        return False, _clean_extraction_error(str(e))


def _extract_zip(zip_path: str, output_dir: str) -> Tuple[bool, str]:
    """Extract a ZIP archive using Python's built-in zipfile module."""
    import zipfile
    
    basename = os.path.basename(zip_path)
    logger.info(f"Extracting ZIP: {basename}")
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(output_dir)
        logger.info("ZIP extraction successful")
        return True, "Extracted ZIP"
    except Exception as e:
        logger.error(f"ZIP extraction failed: {e}")
        return False, _clean_extraction_error(str(e))


def _extract_7z(sevenz_path: str, output_dir: str) -> Tuple[bool, str]:
    """Extract a 7z archive using 7z or 7za (p7zip)."""
    basename = os.path.basename(sevenz_path)
    logger.info(f"Extracting 7z: {basename}")

    for cmd in (["7z", "x", "-y", f"-o{output_dir}", sevenz_path],
                ["7za", "x", "-y", f"-o{output_dir}", sevenz_path]):
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=7200
            )

            if result.returncode == 0:
                logger.info("7z extraction successful")
                return True, "Extracted 7z"

            out = (result.stdout or "").strip()
            err = (result.stderr or "").strip()
            combined = "\n".join(s for s in (out, err) if s)
            if not combined:
                combined = f"Exit code {result.returncode}"

            logger.error(f"7z extraction failed: {combined[:400]}")
            return False, _clean_extraction_error(combined[:500])
        except FileNotFoundError:
            continue
        except subprocess.TimeoutExpired:
            return False, "Extraction timed out (2 hours)"
        except Exception as e:
            return False, _clean_extraction_error(str(e))

    return False, "7z/7za command not found (install p7zip-full)"


def _clean_extraction_error(raw_error: str) -> str:
    """Produce a concise, user-friendly extraction error.
    
    Strips verbose 7z/unrar banners and paths, keeps the
    meaningful error reason.
    """
    if not raw_error:
        return "Unknown extraction error"

    # Check for common known error patterns and return clean messages
    lower = raw_error.lower()

    if 'no files to extract' in lower or 'no files' in lower:
        return "Archive is empty or contains no extractable files"
    if 'wrong password' in lower or 'encrypted' in lower:
        return "Archive is password-protected"
    if 'unexpected end of archive' in lower or 'truncated' in lower:
        return "Archive is incomplete or corrupted"
    if 'cannot open' in lower and 'volume' in lower:
        return "Missing archive volumes (split archive incomplete)"
    if 'crc failed' in lower or 'checksum' in lower:
        return "Archive data is corrupted (CRC error)"
    if 'data error' in lower:
        return "Archive data is corrupted"
    if 'not found' in lower and ('command' in lower or 'no such file' in lower):
        return "Extraction tool not available"
    if 'timed out' in lower or 'timeout' in lower:
        return "Extraction timed out"
    if 'disk full' in lower or 'no space' in lower:
        return "Not enough disk space for extraction"

    # Generic: strip 7z/unrar banners and return just the error essence
    # Remove 7z version banner lines
    lines = raw_error.split('\n')
    meaningful = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # Skip banner/header lines
        if line.startswith('7-Zip') or line.startswith('p7zip'):
            continue
        if 'Copyright' in line or 'Igor Pavlov' in line:
            continue
        if line.startswith('64-bit') or line.startswith('32-bit'):
            continue
        if 'Scanning the drive' in line:
            continue
        if re.match(r'^\d+ file', line):
            continue
        if line.startswith('Extracting archive:'):
            continue
        if line.startswith('UNRAR') or line.startswith('unrar'):
            continue
        meaningful.append(line)

    if meaningful:
        # Return first 2 meaningful lines
        result = '; '.join(meaningful[:2])
        if len(result) > 120:
            result = result[:117] + '...'
        return result

    return "Extraction failed"


# ── Cleanup ──────────────────────────────────────────────────────

def cleanup_archives(directory: str) -> int:
    """Remove archive and par2 files after successful extraction.
    
    Only removes files if video/media files are present (extraction succeeded).
    
    Returns:
        Number of files removed.
    """
    if not _has_video_files(directory):
        logger.info("No video files found after extraction, skipping cleanup")
        return 0
    
    removed = 0
    archive_patterns = {
        '.rar', '.r00', '.r01', '.r02', '.r03', '.r04', '.r05',
        '.r06', '.r07', '.r08', '.r09',
        '.par2', '.nfo', '.sfv', '.srr', '.srs', '.nzb',
        '.zip', '.7z',
    }
    
    for f in os.listdir(directory):
        fpath = os.path.join(directory, f)
        if not os.path.isfile(fpath):
            continue
        
        ext = os.path.splitext(f)[1].lower()
        basename = f.lower()
        
        should_remove = ext in archive_patterns
        
        if not should_remove and re.match(r'.*\.[rs]\d{2,3}$', basename):
            should_remove = True
        
        if not should_remove and re.search(r'\.part\d+\.rar$', basename):
            should_remove = True
        
        if not should_remove and '.vol' in basename and basename.endswith('.par2'):
            should_remove = True
        
        if should_remove:
            try:
                os.remove(fpath)
                removed += 1
            except Exception as e:
                logger.warning(f"Failed to remove {f}: {e}")
    
    if removed > 0:
        logger.info(f"Cleanup removed {removed} archive/par2 files")
    
    return removed


# ── Main post-processing pipeline ────────────────────────────────

def post_process(directory: str, item_name: str = "") -> Tuple[bool, str]:
    """Run the full post-processing pipeline on a completed download.
    
    Pipeline:
      0. Deobfuscate filenames (magic-byte detection)
      1. par2 verification/repair
      2. Archive extraction (RAR, ZIP, 7z)
      3. Cleanup of source files
    
    Args:
        directory: Path to the completed download directory
        item_name: Name of the download item (for logging)
    
    Returns:
        (success: bool, message: str)
    """
    log_prefix = f"[{item_name}] " if item_name else ""
    
    if not os.path.isdir(directory):
        return False, f"Directory not found: {directory}"
    
    files = os.listdir(directory)
    if not files:
        return False, "Download directory is empty"
    
    logger.info(f"{log_prefix}Starting post-processing in {directory}")
    logger.info(f"{log_prefix}Found {len(files)} files")
    
    # Step 0: Deobfuscate filenames — detect by magic bytes, rename
    # so that unrar/7z can find all volumes in multi-part sets.
    # Must run BEFORE par2 (par2 needs correct filenames) and BEFORE
    # archive detection (we need correct extensions).
    renamed = _deobfuscate_files(directory)
    if renamed > 0:
        logger.info(f"{log_prefix}Step 0: Deobfuscated {renamed} files")
        # Re-read file list after renames
        files = os.listdir(directory)
    
    # Check if there are any archives to process
    rar_files = _find_rar_files(directory)
    par2_files = _find_par2_files(directory)
    zip_files = _find_zip_files(directory)
    sevenz_files = _find_7z_files(directory)
    
    has_archives = bool(rar_files or zip_files or sevenz_files)
    
    if not has_archives and _has_video_files(directory):
        logger.info(f"{log_prefix}No archives found, video files already present - "
                    "skipping extraction")
        if par2_files:
            cleanup_archives(directory)
        return True, "No extraction needed, video files present"
    
    # Step 1: par2 verification/repair
    par2_ok = True
    if par2_files:
        logger.info(f"{log_prefix}Step 1: par2 verification ({len(par2_files)} par2 files)")
        par2_ok, par2_msg = run_par2_repair(directory)
        if not par2_ok:
            logger.error(f"{log_prefix}par2 repair failed: {par2_msg}")
    else:
        logger.info(f"{log_prefix}Step 1: No par2 files, skipping verification")
    
    # Step 2: Extract archives
    if has_archives:
        logger.info(f"{log_prefix}Step 2: Extracting archives "
                    f"({len(rar_files)} RAR, {len(zip_files)} ZIP, "
                    f"{len(sevenz_files)} 7z)")
        extract_ok, extract_msg = extract_archives(directory)
        if not extract_ok:
            logger.error(f"{log_prefix}Extraction failed: {extract_msg}")
            return False, f"Extraction failed: {extract_msg}"
        logger.info(f"{log_prefix}Extraction complete: {extract_msg}")
    else:
        logger.info(f"{log_prefix}Step 2: No archives to extract")
    
    # Step 3: Cleanup
    logger.info(f"{log_prefix}Step 3: Cleaning up source files")
    removed = cleanup_archives(directory)
    
    # Final check
    remaining = os.listdir(directory)
    video_present = _has_video_files(directory)
    
    logger.info(f"{log_prefix}Post-processing complete: {len(remaining)} files remaining, "
                f"video present: {video_present}")
    
    if has_archives and not video_present:
        return False, "Extraction completed but no video files found"
    
    # If par2 failed AND no archives AND no video files, the download
    # only contains par2/recovery data with no actual content — fail it
    if not par2_ok and not has_archives and not video_present:
        return False, "Download contains only par2 recovery files — no video or archive data was downloaded"
    
    # If there are no archives, no video files, and only par2/nfo/misc
    # files remain, the download is incomplete (missing data files)
    if not has_archives and not video_present and par2_files:
        return False, "Download incomplete — only par2 recovery files present, no video or archive data"
    
    return True, f"Post-processing complete ({removed} files cleaned up)"
