import json
import logging
from redis import Redis
from redis.exceptions import WatchError
from app.config import REDIS_URL

redis = Redis.from_url(REDIS_URL, decode_responses=True)
logger = logging.getLogger("minimi.worker.jobs")

def save_job(job_id: str, data: dict) -> None:
    try:
        redis.set(f"minimi:job:{job_id}", json.dumps(data), ex=60 * 60 * 24 * 30)
    except Exception:
        logger.exception("Job metadata write failed", extra={"fields": {"jobId": job_id, "operation": "write"}})
        raise

def load_job(job_id: str) -> dict | None:
    try:
        value = redis.get(f"minimi:job:{job_id}")
    except Exception:
        logger.exception("Job metadata lookup failed", extra={"fields": {"jobId": job_id, "operation": "lookup"}})
        raise
    if value is None:
        logger.info("Job metadata not found", extra={"fields": {"jobId": job_id}})
        return None
    return json.loads(value) if value else None

def update_job(job_id: str, **updates) -> dict | None:
    key = f"minimi:job:{job_id}"
    try:
        with redis.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(key)
                    value = pipe.get(key)
                    if not value:
                        logger.info("Job metadata not found for update", extra={"fields": {"jobId": job_id}})
                        return None
                    current = json.loads(value)
                    current.update(updates)
                    pipe.multi()
                    pipe.set(key, json.dumps(current), ex=60 * 60 * 24 * 30)
                    pipe.execute()
                    return current
                except WatchError:
                    pipe.reset()
    except Exception:
        logger.exception("Job metadata update failed", extra={"fields": {"jobId": job_id, "operation": "update"}})
        raise
