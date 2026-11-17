from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.services.job_service import redis
from app.celery_app import celery_app

router = APIRouter()

@router.get("/internal/health")
def health():
    try:
        redis.ping()
        workers = celery_app.control.ping(timeout=1.0)
        if not workers:
            return JSONResponse(status_code=503, content={"success": False, "data": {"workerApi": "ready", "redis": "ready", "celery": "unavailable"}, "error": {"code": "CELERY_UNAVAILABLE"}})
        return {"success": True, "data": {"workerApi": "ready", "redis": "ready", "celery": "ready", "workers": len(workers)}, "error": None}
    except Exception:
        return JSONResponse(status_code=503, content={"success": False, "data": {"workerApi": "ready", "redis": "unavailable"}, "error": {"code": "REDIS_UNAVAILABLE"}})
