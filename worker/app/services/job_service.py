import json
from redis import Redis
from app.config import REDIS_URL

redis = Redis.from_url(REDIS_URL, decode_responses=True)

def save_job(job_id: str, data: dict) -> None:
    redis.set(f"minimi:job:{job_id}", json.dumps(data), ex=60 * 60 * 24 * 30)

def load_job(job_id: str) -> dict | None:
    value = redis.get(f"minimi:job:{job_id}")
    return json.loads(value) if value else None

def update_job(job_id: str, **updates) -> dict | None:
    current = load_job(job_id)
    if not current:
        return None
    current.update(updates)
    save_job(job_id, current)
    return current
