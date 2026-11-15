import json
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile

from app.config import INTERNAL_SECRET, MAX_AUDIO_DURATION_SECONDS, MAX_AUDIO_UPLOAD_BYTES, STORAGE_DIR
from app.services.job_service import load_job, save_job, update_job
from app.utils.validators import inspect_audio
from app.tasks.audio_processing import process_audio_job

router = APIRouter()
MODES = {"standard", "noise_reduced", "multi_speaker"}


def authenticate(x_worker_secret: str = Header(default="")):
    if not INTERNAL_SECRET or not secrets.compare_digest(x_worker_secret, INTERNAL_SECRET):
        raise HTTPException(status_code=401, detail="Internal authentication failed")


@router.post("/internal/audio-processing/jobs", dependencies=[Depends(authenticate)])
async def create_audio_job(user_id: str = Form(...), idempotency_key: str = Form(...), mode: str = Form(default="standard"),
                          language_code: str = Form(default="indic-auto"), output_format: str = Form(default="codemix"),
                          keyterms: str = Form(default="[]"), file: UploadFile = File(...)):
    if mode not in MODES:
        raise HTTPException(status_code=400, detail="Mode must be standard, noise_reduced, or multi_speaker")
    if not idempotency_key or len(idempotency_key) > 120:
        raise HTTPException(status_code=400, detail="A valid idempotency key is required")
    from app.services.job_service import redis
    existing_id = redis.get(f"minimi:audio-processing:idem:{user_id}:{idempotency_key}")
    if existing_id and load_job(existing_id):
        job = load_job(existing_id)
        return {"success": True, "data": {"jobId": existing_id, "status": job["status"], "progress": job.get("progress", 0)}, "error": None}
    if output_format not in {"verbatim", "transcribe", "codemix"}:
        raise HTTPException(status_code=400, detail="Unsupported transcription format")
    try:
        terms = json.loads(keyterms)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid key terms") from exc
    if not isinstance(terms, list) or len(terms) > 200 or any(not isinstance(term, str) for term in terms):
        raise HTTPException(status_code=400, detail="Invalid key terms")
    job_id = f"job_{uuid.uuid4().hex}"
    directory = STORAGE_DIR / job_id
    directory.mkdir(mode=0o700)
    source = directory / f"original{Path(file.filename or 'audio.wav').suffix.lower()}"
    size = 0
    try:
        with source.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_AUDIO_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Audio upload exceeds configured cap")
                output.write(chunk)
        metadata = inspect_audio(source)
        if metadata["duration"] > MAX_AUDIO_DURATION_SECONDS:
            raise HTTPException(status_code=413, detail="Audio duration exceeds configured cap")
        job = {"jobId": job_id, "celeryTaskId": None, "userId": user_id, "type": "AUDIO_PROCESSING", "mode": mode,
               "status": "QUEUED", "progress": 0, "createdAt": datetime.now(timezone.utc).isoformat(), "result": None, "error": None}
        save_job(job_id, job)
        redis.set(f"minimi:audio-processing:idem:{user_id}:{idempotency_key}", job_id, ex=60 * 60 * 24 * 30)
        task = process_audio_job.delay(job_id, str(source), mode, language_code, output_format, terms)
        update_job(job_id, celeryTaskId=task.id)
        return {"success": True, "data": {"jobId": job_id, "status": "QUEUED", "progress": 0}, "error": None}
    except Exception:
        import shutil
        shutil.rmtree(directory, ignore_errors=True)
        raise
