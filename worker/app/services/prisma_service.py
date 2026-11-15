import json
import time
import requests
from app.config import GNANI_API_BASE_URL, GNANI_API_KEY, GNANI_STT_MODEL

def batch_transcribe(paths: list[str], language_code: str, output_format: str, keyterms: list[str], progress, existing_job_id: str | None = None, on_created=None):
    if not GNANI_API_KEY:
        raise ValueError("GNANI_API_KEY is not configured")
    config = {"model": GNANI_STT_MODEL, "language_code": language_code, "format": output_format}
    if keyterms:
        config["keyterms"] = keyterms
    headers = {"X-API-Key-ID": GNANI_API_KEY}
    config["mode"] = "transcribe"
    if existing_job_id:
        job_id = existing_job_id
        response = requests.get(f"{GNANI_API_BASE_URL}/stt/v3/batch/jobs/{job_id}", headers=headers, timeout=30)
        response.raise_for_status()
        initial_status = response.json().get("status", "").upper()
        if initial_status == "CREATED":
            requests.post(f"{GNANI_API_BASE_URL}/stt/v3/batch/jobs/{job_id}/start", headers=headers, timeout=30).raise_for_status()
    else:
        files = [("config", (None, json.dumps(config), "application/json"))]
        files.extend(("files", (path.split("/")[-1], open(path, "rb"), "application/octet-stream")) for path in paths)
        try:
            try:
                response = requests.post(f"{GNANI_API_BASE_URL}/stt/v3/batch/jobs", headers=headers, files=files, timeout=120)
                response.raise_for_status()
                job_id = response.json()["job_id"]
            except (requests.Timeout, requests.ConnectionError) as exc:
                # The remote create may have succeeded even when its response was lost.
                # Do not retry blindly and create a duplicate provider job.
                raise RuntimeError("Prisma batch create outcome is unknown; refusing to submit a duplicate job") from exc
        finally:
            for _, item in files:
                if hasattr(item[1], "close"):
                    item[1].close()
        if on_created:
            on_created(job_id)
        for _ in range(5):
            start_resp = requests.post(f"{GNANI_API_BASE_URL}/stt/v3/batch/jobs/{job_id}/start", headers=headers, timeout=30)
            if start_resp.status_code == 429:
                time.sleep(3)
                continue
            start_resp.raise_for_status()
            break
    while True:
        time.sleep(10)
        response = requests.get(f"{GNANI_API_BASE_URL}/stt/v3/batch/jobs/{job_id}", headers=headers, timeout=30)
        if response.status_code == 429:
            time.sleep(3)
            continue
        response.raise_for_status()
        job = response.json()
        status = job.get("status", "").upper()
        counters = job.get("progress", {})
        total = int(counters.get("total_files", len(paths)) or len(paths))
        finished = sum(int(counters.get(key, 0) or 0) for key in ("completed_files", "failed_files", "cancelled_files"))
        percent = min(100, int(finished / max(total, 1) * 100))
        progress(status, percent, counters)
        if status in {"COMPLETED", "PARTIAL_FAILURE", "FAILED", "START_FAILED", "CANCELLED"}:
            break
    if status not in {"COMPLETED", "PARTIAL_FAILURE"}:
        raise RuntimeError(f"Prisma batch job ended with {status}")
    time.sleep(2)
    response = None
    for _ in range(6):
        response = requests.get(f"{GNANI_API_BASE_URL}/stt/v3/batch/jobs/{job_id}/files?limit=100", headers=headers, timeout=30)
        if response.status_code == 429:
            time.sleep(4)
            continue
        response.raise_for_status()
        break
    if response is None:
        raise RuntimeError("Failed to fetch batch job files from Prisma")
    result_files = response.json().get("data", [])
    transcripts = []
    for item in result_files:
        transcript_url = item.get("transcript_url")
        if transcript_url:
            for _ in range(3):
                transcript_response = requests.get(transcript_url, timeout=30)
                if transcript_response.status_code == 429:
                    time.sleep(2)
                    continue
                transcript_response.raise_for_status()
                parsed = transcript_response.json()
                if isinstance(parsed, dict):
                    transcripts.append({**item, **parsed})
                else:
                    transcripts.append(item)
                break
        else:
            transcripts.append(item)
    return {"providerJobId": job_id, "status": status, "files": transcripts}
