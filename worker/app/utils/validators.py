from pathlib import Path
from app.utils.audio_probe import probe_audio

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".ogg", ".flac", ".aac", ".m4a", ".webm", ".mp4", ".opus", ".amr"}

def inspect_audio(path: Path) -> dict:
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ValueError("Unsupported audio extension")
    return probe_audio(path)
