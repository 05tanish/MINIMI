import shutil
from datetime import datetime, timezone
from pathlib import Path

import requests
from celery.utils.log import get_task_logger

from app.celery_app import celery_app
from app.config import AUDIO_CHUNK_DURATION_SECONDS, GNANI_STT_MODEL, MAX_RETRIES
from app.services.audio_processing.diarization import analyze
from app.services.audio_processing.chunking import chunk_offset, split_for_prisma
from app.services.audio_processing.pipeline import preprocess
from app.services.audio_processing.segments import annotate_segments
from app.services.job_service import load_job, update_job
from app.services.prisma_service import batch_transcribe

logger = get_task_logger(__name__)


@celery_app.task(bind=True, max_retries=MAX_RETRIES, name="audio.process_advanced")
def process_audio_job(self, job_id: str, source_path: str, mode: str, language_code: str, output_format: str, keyterms: list[str]):
    source = Path(source_path)
    work = source.parent / "working-16khz-mono.wav"
    try:
        if GNANI_STT_MODEL.lower() != "prisma-v3.0":
            raise RuntimeError("Advanced audio processing requires Gnani Prisma v3.0")
        update_job(job_id, status="PROCESSING", stage="PREPROCESSING", progress=5)
        metadata = preprocess(source, work, denoise=mode == "noise_reduced")
        if not metadata["speechRegions"]:
            if metadata.get("duration", 0) > 0.5:
                # If VAD was too aggressive on quiet speech, preserve the full duration for STT
                metadata["speechRegions"] = [{"start": 0.0, "end": metadata["duration"]}]
            else:
                raise ValueError("No speech regions detected")
        chunks = split_for_prisma(work, metadata["duration"])
        current = load_job(job_id) or {}
        # Prisma v3 emits anonymous speaker labels without requiring a failure-prone
        # provider diarization mode. Local pyannote is optional and failure-tolerant.
        provider_result = batch_transcribe([str(chunk) for chunk in chunks], language_code, output_format, keyterms,
            lambda state, percent, counters: update_job(job_id, stage="TRANSCRIBING", progress=min(90, 15 + int(percent * .75)), providerState=state, providerProgress=counters),
            existing_job_id=current.get("providerJobId"), on_created=lambda provider_job_id: update_job(job_id, providerJobId=provider_job_id))
        update_job(job_id, stage="DIARIZATION", progress=92)
        local_diarization = analyze(str(work)) if mode == "multi_speaker" else {"enabled": False, "available": False}
        segments = []
        offsets = {chunk.name: chunk_offset(chunk) for chunk in chunks}
        for item in provider_result.get("files", []):
            file_name = Path(item.get("original_path", "")).name
            offset = offsets.get(file_name, 0.0)
            for raw in item.get("segments", []):
                segment = dict(raw)
                start = segment.get("start_time", segment.get("start"))
                end = segment.get("end_time", segment.get("end"))
                if isinstance(start, (int, float)) and isinstance(end, (int, float)):
                    segment["start_time"] = start + offset
                    segment["end_time"] = end + offset
                    if (offset > 0 and start < 3.0) or (offset == 0 and start >= min(AUDIO_CHUNK_DURATION_SECONDS, 300) - 1.5):
                        segment["uncertain"] = True
                    segments.append(segment)
        segments = annotate_segments(segments, local_diarization.get("turns", []) if local_diarization.get("available") else [])
        segments.sort(key=lambda segment: segment.get("start_time", 0))
        # Provider diarization labels are made anonymous when returned.
        for segment in segments:
            if segment.get("overlapping_speech"):
                segment["uncertain"] = True
        transcript = " ".join(str(seg.get("text", "")).strip() for seg in segments if str(seg.get("text", "")).strip())
        if not transcript:
            transcript = " ".join(str(item.get("full_transcript", "")).strip() for item in provider_result.get("files", []) if item.get("full_transcript"))
        warnings = []
        if local_diarization.get("warning"):
            warnings.append(local_diarization["warning"])
        if metadata.get("denoise") == "fallback_unfiltered":
            warnings.append("DENOISE_UNAVAILABLE_USING_ORIGINAL_AUDIO_COPY")
        result = {"mode": mode, "transcript": transcript,
                  "segments": segments, "files": [{"full_transcript": item.get("full_transcript"), "language_detected": item.get("language_detected")} for item in provider_result.get("files", [])],
                  "language": next((s.get("language_detected") for s in segments if s.get("language_detected")), language_code),
                  "provider": {"name": "Gnani Prisma", "model": GNANI_STT_MODEL, "status": provider_result.get("status")},
                  "audioAnalysis": {k: v for k, v in metadata.items() if k != "path"},
                  "diarization": local_diarization,
                  "warnings": warnings}
        update_job(job_id, status="COMPLETED", stage="COMPLETED", progress=100, result=result, completedAt=datetime.now(timezone.utc).isoformat())
        return result
    except (requests.Timeout, requests.ConnectionError) as exc:
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=min(60, 2 ** (self.request.retries + 1)))
        update_job(job_id, status="FAILED", error={"category": "PROVIDER_UNAVAILABLE"})
        raise
    except Exception as exc:
        logger.exception("Advanced audio task failed", extra={"job_id": job_id})
        update_job(job_id, status="FAILED", error={"category": "NO_SPEECH" if isinstance(exc, ValueError) else "AUDIO_PROCESSING_FAILED"}, completedAt=datetime.now(timezone.utc).isoformat())
        raise
    finally:
        # Keep the original recording; only remove the derived processing copy.
        work.unlink(missing_ok=True)
        for chunk in source.parent.glob("part-t*.mp3"):
            chunk.unlink(missing_ok=True)
