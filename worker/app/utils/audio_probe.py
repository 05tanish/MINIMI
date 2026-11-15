import re
import subprocess
from pathlib import Path

from app.utils.ffmpeg import ffmpeg_executable


def probe_audio(path: Path) -> dict:
    """Read container/duration from FFmpeg's demuxer without a separate ffprobe binary."""
    result = subprocess.run([
        ffmpeg_executable(), "-nostdin", "-hide_banner", "-i", str(path), "-t", "0.01", "-f", "null", "-"
    ], capture_output=True, text=True, timeout=30)
    log = result.stderr or ""
    duration_match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", log)
    format_match = re.search(r"Input #\d+, (.*?), from ", log)
    if result.returncode != 0 or "Audio:" not in log or not format_match:
        raise ValueError("Audio duration or stream could not be verified")

    duration = 0.0
    if duration_match:
        duration = int(duration_match[1]) * 3600 + int(duration_match[2]) * 60 + float(duration_match[3])
    else:
        # Fallback for streaming / MediaRecorder containers (e.g. WebM/OGG) where header duration is N/A:
        decode_result = subprocess.run([
            ffmpeg_executable(), "-nostdin", "-hide_banner", "-i", str(path), "-f", "null", "-"
        ], capture_output=True, text=True, timeout=30)
        time_matches = re.findall(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)", decode_result.stderr or "")
        if time_matches:
            h, m, s = time_matches[-1]
            duration = int(h) * 3600 + int(m) * 60 + float(s)

    if duration <= 0:
        raise ValueError("Audio duration could not be verified")
    return {"duration": duration, "format": format_match[1], "streams": []}
