
import ssl

from celery import Celery

from .config import CELERY_BROKER_URL, CELERY_RESULT_BACKEND

celery_app = Celery(
    "minimi_worker",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=[
        "app.tasks.transcription",
        "app.tasks.speech_synthesis",
        "app.tasks.audio_processing",
    ],
)

redis_ssl_config = {
    "ssl_cert_reqs": ssl.CERT_REQUIRED,
}

celery_app.conf.update(
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=60 * 60 * 24 * 7,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],

    broker_use_ssl=redis_ssl_config,
    redis_backend_use_ssl=redis_ssl_config,
)
