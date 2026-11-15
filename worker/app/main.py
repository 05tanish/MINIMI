from fastapi import FastAPI
from app.api.health import router as health_router
from app.api.audio_processing import router as audio_processing_router
from app.api.jobs import router as jobs_router

app = FastAPI(title="Minimi internal worker gateway", docs_url=None, redoc_url=None)
app.include_router(health_router)
app.include_router(audio_processing_router)
app.include_router(jobs_router)
