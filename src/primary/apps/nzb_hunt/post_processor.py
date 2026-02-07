"""
NZB Hunt Post-Processor - Handles extraction and cleanup after download.

Implements the same post-processing pipeline as SABnzbd:
  1. par2 verification and repair (if par2 files exist)
  2. RAR extraction (if RAR files exist)
  3. Cleanup of source archives and par2 files
  4. Final file placement

Requires system packages: unrar-free (or unrar), par2, p7zip-full
"""

import os
import re
import glob
import shutil
import subprocess
from typing import Optional, Tuple, List

from src.primary.utils.logger import get_logger

logger = get_logger("nzb_hunt.postprocess")


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
            # Must be a real file with data, not 0-byte
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
    
    # First try verification only
    try:
        result = subprocess.run(
            ["par2", "verify", main_par2],
            cwd=directory,
            capture_output=True,
            text=True,
            timeout=3600  # 1 hour timeout
        )
        
        if result.returncode == 0:
            logger.info("par2 verification passed - all files intact")
            return True, "par2 verification passed"
        
        # Check for "Main packet not found" - means no index par2, just skip
        combined_output = (result.stdout or '') + (result.stderr or '')
        if 'main packet not found' in combined_output.lower():
            logger.info("par2: no main packet in par2 files (volume-only set), skipping verification")
            return True, "par2 skipped (volume-only set, no index file)"
        
        # Verification failed, try repair
        logger.warning(f"par2 verification failed (rc={result.returncode}), attempting repair...")
        
        result = subprocess.run(
            ["par2", "repair", main_par2],
            cwd=directory,
            capture_output=True,
            text=True,
            timeout=7200  # 2 hour timeout for repair
        )
        
        if result.returncode == 0:
            logger.info("par2 repair successful")
            return True, "par2 repair successful"
        else:
            msg = (result.stderr or result.stdout or '')[:500]
            logger.warning(f"par2 repair failed (rc={result.returncode}): {msg}")
            # Don't treat par2 failure as fatal - extraction may still work
            return True, f"par2 repair failed but continuing: {msg[:100]}"
            
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
    """
    basename = os.path.basename(rar_path)
    logger.info(f"Extracting RAR: {basename} -> {output_dir}")
    
    # Try unrar first (supports RAR5 format)
    for unrar_cmd in ["unrar", "unrar-free"]:
        try:
            result = subprocess.run(
                [unrar_cmd, "x", "-o+", "-y", rar_path, output_dir + "/"],
                capture_output=True,
                text=True,
                timeout=7200  # 2 hours
            )
            
            if result.returncode == 0:
                logger.info(f"RAR extraction successful with {unrar_cmd}")
                return True, f"Extracted with {unrar_cmd}"
            else:
                combined = ((result.stdout or '') + '\n' + (result.stderr or '')).strip()
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
            logger.error(f"7z extraction failed (rc={result.returncode}): {combined[:500]}")
            return False, f"7z failed: {combined[:200]}"
    except FileNotFoundError:
        logger.error("No RAR extraction tool found (tried unrar, unrar-free, 7z)")
        return False, "No extraction tool available"
    except subprocess.TimeoutExpired:
        return False, "Extraction timed out"
    except Exception as e:
        return False, str(e)


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
        return False, str(e)


def _extract_7z(sevenz_path: str, output_dir: str) -> Tuple[bool, str]:
    """Extract a 7z archive."""
    basename = os.path.basename(sevenz_path)
    logger.info(f"Extracting 7z: {basename}")
    
    try:
        result = subprocess.run(
            ["7z", "x", "-y", f"-o{output_dir}", sevenz_path],
            capture_output=True,
            text=True,
            timeout=7200
        )
        
        if result.returncode == 0:
            logger.info("7z extraction successful")
            return True, "Extracted 7z"
        else:
            logger.error(f"7z extraction failed: {result.stderr[:300]}")
            return False, f"7z failed: {result.stderr[:200]}"
    except FileNotFoundError:
        return False, "7z command not found"
    except Exception as e:
        return False, str(e)


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
        
        # Check direct extension match
        should_remove = ext in archive_patterns
        
        # Check old-style RAR naming (.r00-.r99, .s00-.s99)
        if not should_remove and re.match(r'.*\.[rs]\d{2,3}$', basename):
            should_remove = True
        
        # Check multi-part RAR (.partXX.rar)
        if not should_remove and re.search(r'\.part\d+\.rar$', basename):
            should_remove = True
        
        # Check par2 volume files (.vol000+01.par2)
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
    
    # Check if there are any archives to process
    rar_files = _find_rar_files(directory)
    par2_files = _find_par2_files(directory)
    zip_files = _find_zip_files(directory)
    sevenz_files = _find_7z_files(directory)
    
    has_archives = bool(rar_files or zip_files or sevenz_files)
    
    if not has_archives and _has_video_files(directory):
        logger.info(f"{log_prefix}No archives found, video files already present - "
                    "skipping extraction")
        # Still clean up par2/nfo files if present
        if par2_files:
            cleanup_archives(directory)
        return True, "No extraction needed, video files present"
    
    # Step 1: par2 verification/repair
    if par2_files:
        logger.info(f"{log_prefix}Step 1: par2 verification ({len(par2_files)} par2 files)")
        par2_ok, par2_msg = run_par2_repair(directory)
        if not par2_ok:
            logger.error(f"{log_prefix}par2 repair failed: {par2_msg}")
            # Continue anyway - extraction might still work
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
    
    return True, f"Post-processing complete ({removed} files cleaned up)"
