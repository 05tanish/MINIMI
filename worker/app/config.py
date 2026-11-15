import os
from pathlib import Path

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/1")
GNANI_API_KEY = os.getenv("GNANI_API_KEY") or os.getenv("GNANI_API", "")
GNANI_API_BASE_URL = os.getenv("GNANI_API_BASE_URL", "https://api.vachana.ai").rstrip("/")
GNANI_STT_MODEL = os.getenv("GNANI_STT_MODEL", "prisma-v3.0")
GNANI_TTS_MODEL = os.getenv("GNANI_TTS_MODEL", "timbre-v3.0")
INTERNAL_SECRET = os.getenv("WORKER_INTERNAL_SECRET", "")
MAX_AUDIO_SIZE_MB = int(os.getenv("MAX_AUDIO_SIZE_MB", "10"))
MAX_AUDIO_UPLOAD_BYTES = int(os.getenv("MAX_AUDIO_UPLOAD_BYTES", str(100 * 1024 * 1024)))
MAX_AUDIO_DURATION_SECONDS = int(os.getenv("MAX_AUDIO_DURATION_SECONDS", "3600"))
AUDIO_CHUNK_DURATION_SECONDS = int(os.getenv("AUDIO_CHUNK_DURATION_SECONDS", "300"))
AUDIO_CHUNK_OVERLAP_SECONDS = int(os.getenv("AUDIO_CHUNK_OVERLAP_SECONDS", "3"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
PYANNOTE_ENABLED = os.getenv("PYANNOTE_ENABLED", "false").lower() == "true"
PYANNOTE_TOKEN = os.getenv("PYANNOTE_TOKEN", "")
PYANNOTE_MODEL = os.getenv("PYANNOTE_MODEL", "pyannote/speaker-diarization-community-1")
VAD_MIN_SILENCE_SECONDS = float(os.getenv("AUDIO_VAD_MIN_SILENCE_SECONDS", "0.35"))
STORAGE_DIR = Path(os.getenv("WORKER_STORAGE_DIR", "/data/audio"))
if MAX_AUDIO_SIZE_MB <= 0 or MAX_AUDIO_UPLOAD_BYTES <= 0 or MAX_AUDIO_DURATION_SECONDS <= 0 or AUDIO_CHUNK_DURATION_SECONDS <= 0:
    raise ValueError("Audio size, duration and chunk configuration values must be positive")
if not 0 <= AUDIO_CHUNK_OVERLAP_SECONDS <= 10 or not 0 <= MAX_RETRIES <= 10:
    raise ValueError("Audio overlap or retry configuration is outside its supported range")
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
