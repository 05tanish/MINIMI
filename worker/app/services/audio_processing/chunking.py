import re
import subprocess
from pathlib import Path

from app.config import AUDIO_CHUNK_DURATION_SECONDS
from app.utils.ffmpeg import ffmpeg_executable


def split_for_prisma(source: Path, duration: float) -> list[Path]:
    """Create small provider-compatible chunks while retaining a 3s boundary overlap."""
    span = max(30, min(AUDIO_CHUNK_DURATION_SECONDS, 300))
    overlap_half = 1.5
    paths = []
    start = 0.0
    while start < duration:
        actual_start = max(0.0, start - overlap_half)
        end = min(duration, start + span + overlap_half)
        destination = source.parent / f"part-t{int(actual_start * 1000):09d}.mp3"
        subprocess.run([
            ffmpeg_executable(), "-nostdin", "-v", "error", "-y", "-ss", str(actual_start), "-i", str(source),
            "-t", str(end - actual_start), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame",
            "-b:a", "64k", str(destination)
        ], capture_output=True, timeout=300, check=True)
        paths.append(destination)
        start += span
    if len(paths) > 100:
        raise ValueError("Audio requires more than 100 provider chunks")
    return paths


def chunk_offset(path: Path) -> float:
    match = re.search(r"-t(\d{9})$", path.stem)
    return int(match.group(1)) / 1000 if match else 0.0
