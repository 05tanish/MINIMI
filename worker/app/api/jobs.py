import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from celery.result import AsyncResult
from app.config import AUDIO_CHUNK_DURATION_SECONDS, AUDIO_CHUNK_OVERLAP_SECONDS, INTERNAL_SECRET, MAX_AUDIO_DURATION_SECONDS, MAX_AUDIO_UPLOAD_BYTES, STORAGE_DIR
from app.celery_app import celery_app
from app.services.job_service import load_job, save_job, update_job
from app.tasks.transcription import transcribe_job
from app.tasks.speech_synthesis import synthesize_job
from app.utils.ffmpeg import ffmpeg_executable
from app.utils.validators import inspect_audio
from app.utils.logger import logger

router = APIRouter()

def authenticate(x_worker_secret: str = Header(default="")):
    if not INTERNAL_SECRET or not secrets.compare_digest(x_worker_secret, INTERNAL_SECRET):
        raise HTTPException(status_code=401, detail="Internal authentication failed")

@router.post("/internal/jobs/transcription", dependencies=[Depends(authenticate)])
async def create_transcription(user_id: str = Form(...), conversation_id: str | None = Form(default=None), language_code: str = Form(default="indic-auto"), output_format: str = Form(default="codemix"), keyterms: str = Form(default="[]"), idempotency_key: str = Form(...), files: list[UploadFile] = File(...)):
    if not files or len(files) > 10:
        raise HTTPException(status_code=400, detail="Upload between 1 and 10 source audio files")
    if output_format not in {"verbatim", "transcribe", "codemix"}:
        raise HTTPException(status_code=400, detail="Unsupported transcription format")
    allowed_languages = {"auto", "indic-auto", "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN"}
    candidates = [value.strip() for value in language_code.split(",")]
    if len(candidates) > 4 or any(value not in allowed_languages for value in candidates) or ("auto" in candidates and len(candidates) > 1) or ("indic-auto" in candidates and len(candidates) > 1):
        raise HTTPException(status_code=400, detail="Unsupported Prisma language hint")
    if not idempotency_key or len(idempotency_key) > 120:
        raise HTTPException(status_code=400, detail="A valid idempotency key is required")
    from app.services.job_service import redis
    existing_id = redis.get(f"minimi:idem:{user_id}:{idempotency_key}")
    if existing_id:
        existing = load_job(existing_id)
        if existing:
            return {"success": True, "data": {"jobId": existing_id, "status": existing["status"], "progress": existing.get("progress", 0)}, "error": None}
    job_id = f"job_{uuid.uuid4().hex}"
    directory = STORAGE_DIR / job_id
    directory.mkdir(mode=0o700)
    paths = []
    try:
        for index, file in enumerate(files):
            if not file.filename or Path(file.filename).suffix.lower() not in {".wav", ".mp3", ".ogg", ".flac", ".aac", ".m4a", ".webm", ".mp4", ".opus", ".amr"}:
                raise HTTPException(status_code=400, detail="Unsupported audio file extension")
            destination = directory / f"source-{index}{Path(file.filename).suffix.lower()}"
            size = 0
            with destination.open("wb") as output:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_AUDIO_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="Audio upload exceeds configured cap")
                    output.write(chunk)
            metadata = inspect_audio(destination)
            if metadata["duration"] > MAX_AUDIO_DURATION_SECONDS:
                raise HTTPException(status_code=413, detail="Audio duration exceeds configured cap")
            actual_formats = set(str(metadata.get("format") or "").split(","))
            extension = destination.suffix.lower()
            expected = {".wav": {"wav"}, ".mp3": {"mp3"}, ".ogg": {"ogg"}, ".flac": {"flac"}, ".aac": {"aac"}, ".m4a": {"mov", "mp4", "m4a"}, ".mp4": {"mov", "mp4", "m4a"}, ".webm": {"matroska", "webm"}, ".opus": {"ogg"}, ".amr": {"amr"}}
            actual_format_mismatch = not actual_formats.intersection(expected.get(extension, set()))
            # Provider direct upload has a 10 MB per file cap; split large/long
            # sources into ordered chunks while keeping each API file compliant.
            max_seconds_by_size = max(30, int(metadata["duration"] * (9_000_000 / size))) if size > 9_000_000 else metadata["duration"]
            segment_seconds = min(AUDIO_CHUNK_DURATION_SECONDS, max_seconds_by_size)
            if metadata["duration"] > segment_seconds or size > 9_000_000 or actual_format_mismatch or extension in {".webm", ".opus"}:
                import subprocess
                overlap_half = max(0, AUDIO_CHUNK_OVERLAP_SECONDS) / 2
                chunk_index = 0
                while chunk_index * segment_seconds < metadata["duration"]:
                    start = max(0, chunk_index * segment_seconds - overlap_half)
                    end = min(metadata["duration"], (chunk_index + 1) * segment_seconds + overlap_half)
                    output_path = directory / f"chunk-{index:04d}-t{int(start * 1000):09d}-{chunk_index:04d}.mp3"
                    subprocess.run([ffmpeg_executable(), "-v", "error", "-ss", str(start), "-i", str(destination), "-t", str(end - start), "-c:a", "libmp3lame", "-b:a", "128k", "-ac", "1", str(output_path)], capture_output=True, timeout=180, check=True)
                    chunk_index += 1
                destination.unlink(missing_ok=True)
                paths.extend(str(item) for item in sorted(directory.glob(f"chunk-{index:04d}-*.mp3")))
            else:
                paths.append(str(destination))
        if len(paths) > 100:
            raise HTTPException(status_code=413, detail="Audio requires more than 100 provider files; submit a shorter recording")
        import json
        terms = json.loads(keyterms)
        if not isinstance(terms, list) or len(terms) > 200 or any(not isinstance(term, str) or len(term) > 120 or "<|" in term or "|>" in term for term in terms):
            raise HTTPException(status_code=400, detail="Invalid key terms")
        now = datetime.now(timezone.utc).isoformat()
        save_job(job_id, {"jobId": job_id, "celeryTaskId": None, "userId": user_id, "conversationId": conversation_id, "type": "TRANSCRIPTION", "status": "QUEUED", "progress": 0, "createdAt": now, "result": None, "error": None})
        from app.services.job_service import redis
        redis.set(f"minimi:idem:{user_id}:{idempotency_key}", job_id, ex=60 * 60 * 24 * 30)
        task = transcribe_job.delay(job_id, paths, language_code, output_format, terms)
        update_job(job_id, celeryTaskId=task.id)
        return {"success": True, "data": {"jobId": job_id, "status": "QUEUED", "progress": 0}, "error": None}
    except Exception:
        import shutil
        shutil.rmtree(directory, ignore_errors=True)
        raise

@router.post("/internal/jobs/synthesis", dependencies=[Depends(authenticate)])
async def create_synthesis(payload: dict):
    user_id, text = payload.get("userId"), payload.get("text")
    speed = payload.get("speed", 1)
    if not user_id or not isinstance(text, str) or not text.strip() or len(text) > 30000 or isinstance(speed, bool) or not isinstance(speed, (int, float)) or speed not in {0.8, 1, 1.2}:
        raise HTTPException(status_code=400, detail="Invalid synthesis request")
    job_id = f"job_{uuid.uuid4().hex}"
    task_id = uuid.uuid4().hex
    save_job(job_id, {"jobId": job_id, "celeryTaskId": task_id, "userId": user_id, "conversationId": payload.get("conversationId"), "type": "SYNTHESIS", "status": "QUEUED", "progress": 0, "createdAt": datetime.now(timezone.utc).isoformat(), "result": None, "error": None})
    try:
        task = synthesize_job.apply_async(args=(job_id, text, payload.get("voice", "Shivani"), payload.get("language", "auto"), speed), task_id=task_id)
    except Exception as exc:
        logger.exception("Speech synthesis task could not be queued", extra={"fields": {"jobId": job_id, "errorType": type(exc).__name__}})
        update_job(job_id, status="FAILED", error={"category": "CELERY_ENQUEUE_FAILED"}, completedAt=datetime.now(timezone.utc).isoformat())
        raise HTTPException(status_code=503, detail="Speech worker could not queue this job") from exc
    logger.info("Speech synthesis job queued", extra={"fields": {"jobId": job_id, "userId": user_id, "textLength": len(text), "celeryTaskId": task.id}})
    return {"success": True, "data": {"jobId": job_id, "status": "QUEUED", "progress": 0}, "error": None}

@router.get("/internal/jobs/{job_id}", dependencies=[Depends(authenticate)])
def get_job(job_id: str):
    job = load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    task = AsyncResult(job["celeryTaskId"], app=celery_app) if job.get("celeryTaskId") else None
    if task and task.state == "FAILURE" and job.get("status") not in {"FAILED", "CANCELLED", "COMPLETED"}:
        logger.error("Celery task failed before job completion was recorded", extra={"fields": {"jobId": job_id, "celeryTaskId": job["celeryTaskId"]}})
        update_job(job_id, status="FAILED", error={"category": "CELERY_TASK_FAILED"}, completedAt=datetime.now(timezone.utc).isoformat())
        job = load_job(job_id) or job
    if task and task.state == "PENDING" and job["status"] == "QUEUED":
        job["status"] = "QUEUED"
    return {"success": True, "data": job, "error": None}

@router.post("/internal/jobs/{job_id}/cancel", dependencies=[Depends(authenticate)])
def cancel_job(job_id: str):
    job = load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    celery_app.control.revoke(job["celeryTaskId"], terminate=True, signal="SIGTERM")
    update_job(job_id, status="CANCELLED", completedAt=datetime.now(timezone.utc).isoformat())
    return {"success": True, "data": {"jobId": job_id, "status": "CANCELLED"}, "error": None}

@router.get("/internal/jobs/{job_id}/audio", dependencies=[Depends(authenticate)])
def get_audio(job_id: str):
    job = load_job(job_id)
    if not job or job.get("status") != "COMPLETED" or not job.get("result", {}).get("audioPath"):
        logger.info("Speech audio is not available", extra={"fields": {"jobId": job_id, "status": job.get("status") if job else "MISSING"}})
        raise HTTPException(status_code=404, detail="Audio result not found")
    path = Path(job["result"]["audioPath"])
    if not path.is_file() or path.parent != STORAGE_DIR:
        raise HTTPException(status_code=404, detail="Audio result not found")
    logger.info("Speech audio requested", extra={"fields": {"jobId": job_id}})
    return FileResponse(path, media_type="audio/wav", filename=f"{job_id}.wav")
