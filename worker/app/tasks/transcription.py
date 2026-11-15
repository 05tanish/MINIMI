from datetime import datetime, timezone
import requests
from pathlib import Path
import re
import shutil
from app.celery_app import celery_app
from app.services.job_service import load_job, update_job
from app.services.prisma_service import batch_transcribe
from app.config import MAX_RETRIES
from app.utils.logger import logger

@celery_app.task(bind=True, max_retries=MAX_RETRIES, name="audio.transcribe")
def transcribe_job(self, job_id: str, paths: list[str], language_code: str, output_format: str, keyterms: list[str]):
    update_job(job_id, status="PROCESSING", progress=5, startedAt=datetime.now(timezone.utc).isoformat())
    try:
        def report_progress(state, percent, counters):
            update_job(job_id, status="PROCESSING", progress=min(95, max(5, int(5 + percent * 0.9))), message=f"Gnani batch {state}", providerProgress=counters)
        current = load_job(job_id) or {}
        result = batch_transcribe(paths, language_code, output_format, keyterms, report_progress, existing_job_id=current.get("providerJobId"), on_created=lambda provider_job_id: update_job(job_id, providerJobId=provider_job_id))
        ordered = sorted(result["files"], key=lambda item: item.get("original_path", ""))
        all_segments = []
        for item in ordered:
            match = re.search(r"-t(\d{9})-", Path(item.get("original_path", "")).name)
            offset_seconds = int(match.group(1)) / 1000 if match else 0
            for segment in item.get("segments", []):
                if isinstance(segment.get("start_time"), (int, float)):
                    segment["start_time"] += offset_seconds
                if isinstance(segment.get("end_time"), (int, float)):
                    segment["end_time"] += offset_seconds
                if segment.get("text", "").strip():
                    all_segments.append(segment)
        all_segments.sort(key=lambda item: item.get("start_time", 0))
        reconstructed = []
        for segment in all_segments:
            text = segment.get("text", "").strip()
            normalized = re.sub(r"[^\w]+", " ", text.casefold()).strip()
            previous = reconstructed[-1] if reconstructed else None
            previous_text = re.sub(r"[^\w]+", " ", (previous or {}).get("text", "").casefold()).strip()
            overlaps = previous and segment.get("start_time", 0) < previous.get("end_time", 0)
            duplicate = overlaps and (normalized == previous_text or (min(len(normalized), len(previous_text)) > 12 and (normalized in previous_text or previous_text in normalized)))
            if not duplicate:
                reconstructed.append(segment)
        good = [item for item in ordered if item.get("full_transcript") is not None]
        status = "COMPLETED" if len(good) == len(paths) and result["status"] == "COMPLETED" else "PARTIALLY_COMPLETED" if good else "FAILED"
        result["files"] = ordered
        result["segments"] = reconstructed
        result["transcript"] = " ".join(item["text"] for item in reconstructed) if reconstructed else "\n".join(item.get("full_transcript", "") for item in good)
        update_job(job_id, status=status, progress=100, result=result, completedAt=datetime.now(timezone.utc).isoformat())
        if paths:
            shutil.rmtree(Path(paths[0]).parent, ignore_errors=True)
        return result
    except (requests.Timeout, requests.ConnectionError) as exc:
        if self.request.retries >= self.max_retries:
            update_job(job_id, status="FAILED", error={"category": "PROVIDER_UNAVAILABLE"})
            if paths:
                shutil.rmtree(Path(paths[0]).parent, ignore_errors=True)
            raise
        raise self.retry(exc=exc, countdown=min(60, 2 ** self.request.retries))
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else 0
        if status_code == 429 and self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=min(60, 2 ** (self.request.retries + 1)))
        update_job(job_id, status="FAILED", error={"category": "PROVIDER_REJECTED"}, completedAt=datetime.now(timezone.utc).isoformat())
        if paths:
            shutil.rmtree(Path(paths[0]).parent, ignore_errors=True)
        raise
    except Exception as exc:
        logger.exception("Transcription task failed", extra={"fields": {"jobId": job_id}})
        update_job(job_id, status="FAILED", error={"category": "TRANSCRIPTION_FAILED"}, completedAt=datetime.now(timezone.utc).isoformat())
        if paths:
            shutil.rmtree(Path(paths[0]).parent, ignore_errors=True)
        raise
