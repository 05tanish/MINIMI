from datetime import datetime, timezone
from pathlib import Path
import subprocess
import shutil
import re
import random
import time
import requests
from app.celery_app import celery_app
from app.config import MAX_RETRIES, STORAGE_DIR
from app.services.job_service import update_job
from app.services.timbre_service import synthesize
from app.utils.ffmpeg import ffmpeg_executable

@celery_app.task(bind=True, max_retries=MAX_RETRIES, name="audio.synthesize")
def synthesize_job(self, job_id: str, text: str, voice: str, language: str):
    update_job(job_id, status="PROCESSING", progress=10, startedAt=datetime.now(timezone.utc).isoformat())
    try:
        paragraphs = [part.strip() for part in text.splitlines() if part.strip()]
        chunks, current = [], ""
        for paragraph in paragraphs or [text]:
            sentences = re.split(r"(?<=[.!?।])\s+", paragraph)
            for sentence in sentences:
                candidate = f"{current} {sentence}".strip()
                if len(candidate) > 4000 and current:
                    chunks.append(current)
                    current = sentence
                else:
                    current = candidate
                if len(current) > 4000:
                    words = current.split()
                    current = ""
                    for word in words:
                        if current and len(current) + len(word) + 1 > 4000:
                            chunks.append(current)
                            current = word
                        else:
                            current = f"{current} {word}".strip()
        if current:
            chunks.append(current)
        directory = STORAGE_DIR / job_id
        directory.mkdir(mode=0o700, exist_ok=True)
        for index, chunk in enumerate(chunks):
            for attempt in range(MAX_RETRIES + 1):
                try:
                    audio = synthesize(chunk, voice, language)
                    break
                except requests.RequestException as exc:
                    status = exc.response.status_code if isinstance(exc, requests.HTTPError) and exc.response is not None else 0
                    retryable = isinstance(exc, (requests.Timeout, requests.ConnectionError)) or status == 429 or status >= 500
                    if not retryable or attempt == MAX_RETRIES:
                        raise
                    time.sleep(min(8, 2 ** attempt) + random.uniform(0, 0.5))
            (directory / f"part-{index:04d}.wav").write_bytes(audio)
            update_job(job_id, progress=min(90, int((index + 1) / len(chunks) * 90)))
        output = STORAGE_DIR / f"{job_id}.wav"
        listing = directory / "parts.txt"
        listing.write_text("".join(f"file '{directory / f'part-{index:04d}.wav'}'\n" for index in range(len(chunks))))
        subprocess.run([ffmpeg_executable(), "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(output)], capture_output=True, timeout=180, check=True)
        result = {"audioPath": str(output)}
        update_job(job_id, status="COMPLETED", progress=100, result=result, completedAt=datetime.now(timezone.utc).isoformat())
        shutil.rmtree(directory, ignore_errors=True)
        return result
    except Exception:
        update_job(job_id, status="FAILED", error={"category": "SYNTHESIS_FAILED"}, completedAt=datetime.now(timezone.utc).isoformat())
        shutil.rmtree(STORAGE_DIR / job_id, ignore_errors=True)
        raise
