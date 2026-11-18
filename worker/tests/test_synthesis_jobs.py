import os
import sys
import json
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("WORKER_STORAGE_DIR", "/tmp/minimi-synthesis-tests")
os.environ.setdefault("WORKER_INTERNAL_SECRET", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api import jobs
from app.services import job_service
from app.services import timbre_service
from app.tasks import speech_synthesis
from redis.exceptions import WatchError
import pytest


app = FastAPI()
app.include_router(jobs.router)
client = TestClient(app)


def auth():
    return {"X-Worker-Secret": jobs.INTERNAL_SECRET or "test-secret"}


@pytest.fixture(autouse=True)
def worker_secret(monkeypatch):
    monkeypatch.setattr(jobs, "INTERNAL_SECRET", "test-secret")


def test_synthesis_creation_saves_and_queues_same_job(monkeypatch):
    saved = {}
    queued = {}
    monkeypatch.setattr(jobs, "save_job", lambda job_id, data: saved.update({job_id: data}))
    monkeypatch.setattr(jobs, "update_job", lambda job_id, **changes: saved[job_id].update(changes))
    monkeypatch.setattr(jobs.synthesize_job, "apply_async", lambda **kwargs: queued.update(kwargs) or SimpleNamespace(id=kwargs["task_id"]))
    response = client.post("/internal/jobs/synthesis", headers=auth(), json={"userId": "user-1", "text": "Hello", "speed": 1.2})
    assert response.status_code == 200
    job_id = response.json()["data"]["jobId"]
    assert job_id in saved
    assert saved[job_id]["type"] == "SYNTHESIS"
    assert saved[job_id]["celeryTaskId"] == queued["task_id"]
    assert queued["args"][0] == job_id


def test_synthesis_accepts_main_api_maximum_text_length(monkeypatch):
    monkeypatch.setattr(jobs, "save_job", lambda *_: None)
    monkeypatch.setattr(jobs, "update_job", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(jobs.synthesize_job, "apply_async", lambda **kwargs: SimpleNamespace(id=kwargs["task_id"]))
    response = client.post("/internal/jobs/synthesis", headers=auth(), json={"userId": "user-1", "text": "x" * 30000})
    assert response.status_code == 200


def test_worker_rejects_unsupported_synthesis_speed(monkeypatch):
    monkeypatch.setattr(jobs, "save_job", lambda *_: (_ for _ in ()).throw(AssertionError("must not persist invalid speed")))
    response = client.post("/internal/jobs/synthesis", headers=auth(), json={"userId": "user-1", "text": "Hello", "speed": 1.05})
    assert response.status_code == 400


def test_timbre_service_forwards_documented_speed(monkeypatch):
    requests = []
    monkeypatch.setattr(timbre_service, "GNANI_API_KEY", "test-key")

    class ProviderResponse:
        content = b"wav"
        def raise_for_status(self): return None

    monkeypatch.setattr(timbre_service.requests, "post", lambda *args, **kwargs: requests.append((args, kwargs)) or ProviderResponse())
    assert timbre_service.synthesize("Hello", "Shivani", "auto", 1.2) == b"wav"
    assert requests[0][1]["json"]["speed"] == 1.2


def test_timbre_service_rejects_unsupported_speed_before_request(monkeypatch):
    calls = []
    monkeypatch.setattr(timbre_service, "GNANI_API_KEY", "test-key")
    monkeypatch.setattr(timbre_service.requests, "post", lambda *args, **kwargs: calls.append(args))
    try:
        timbre_service.synthesize("Hello", "Shivani", "auto", 1.05)
        assert False, "expected invalid speed"
    except ValueError as error:
        assert "speed" in str(error).lower()
    assert calls == []


def test_celery_enqueue_failure_marks_job_failed(monkeypatch):
    saved = {}
    monkeypatch.setattr(jobs, "save_job", lambda job_id, data: saved.update({job_id: data}))
    monkeypatch.setattr(jobs, "update_job", lambda job_id, **changes: saved[job_id].update(changes))
    monkeypatch.setattr(jobs.synthesize_job, "apply_async", lambda **_kwargs: (_ for _ in ()).throw(ConnectionError("broker unavailable")))
    response = client.post("/internal/jobs/synthesis", headers=auth(), json={"userId": "user-1", "text": "Hello"})
    assert response.status_code == 503
    assert next(iter(saved.values()))["status"] == "FAILED"
    assert next(iter(saved.values()))["error"]["category"] == "CELERY_ENQUEUE_FAILED"


def test_internal_synthesis_requires_authentication():
    response = client.post("/internal/jobs/synthesis", json={"userId": "user-1", "text": "Hello"})
    assert response.status_code == 401


def test_missing_job_returns_404(monkeypatch):
    monkeypatch.setattr(jobs, "load_job", lambda _job_id: None)
    response = client.get("/internal/jobs/job_missing", headers=auth())
    assert response.status_code == 404


def test_redis_failure_is_not_reported_as_missing_job(monkeypatch):
    def fail(_key):
        raise ConnectionError("redis offline")

    monkeypatch.setattr(job_service.redis, "get", fail)
    try:
        job_service.load_job("job_redis")
        assert False, "expected Redis error"
    except ConnectionError:
        pass


def test_redis_failure_during_poll_returns_server_error(monkeypatch):
    monkeypatch.setattr(jobs, "load_job", lambda _job_id: (_ for _ in ()).throw(ConnectionError("redis offline")))
    error_client = TestClient(app, raise_server_exceptions=False)
    response = error_client.get("/internal/jobs/job_redis", headers=auth())
    assert response.status_code == 500


def test_job_updates_retry_conflicts_without_overwriting_processing_status(monkeypatch):
    key = "minimi:job:job_race"

    class Pipeline:
        def __init__(self):
            self.value = json.dumps({"jobId": "job_race", "status": "QUEUED"})
            self.first = True
            self.pending = None

        def __enter__(self): return self
        def __exit__(self, *_args): return None
        def watch(self, _key): return None
        def get(self, _key): return self.value
        def multi(self): return None
        def set(self, _key, value, ex): self.pending = (value, ex)
        def execute(self):
            if self.first:
                self.first = False
                self.value = json.dumps({"jobId": "job_race", "status": "PROCESSING", "progress": 10})
                raise WatchError()
            self.value = self.pending[0]
        def reset(self): return None

    pipe = Pipeline()
    monkeypatch.setattr(job_service.redis, "pipeline", lambda: pipe)
    updated = job_service.update_job("job_race", celeryTaskId="celery-1")
    assert updated["status"] == "PROCESSING"
    assert updated["progress"] == 10
    assert updated["celeryTaskId"] == "celery-1"


def test_celery_failure_is_reflected_in_job_status(monkeypatch):
    item = {"jobId": "job_failed", "userId": "user-1", "status": "QUEUED", "celeryTaskId": "celery-failed"}
    monkeypatch.setattr(jobs, "load_job", lambda _job_id: dict(item))
    monkeypatch.setattr(jobs, "update_job", lambda _job_id, **updates: item.update(updates) or item)
    monkeypatch.setattr(jobs, "AsyncResult", lambda *_args, **_kwargs: SimpleNamespace(state="FAILURE"))
    response = client.get("/internal/jobs/job_failed", headers=auth())
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "FAILED"
    assert response.json()["data"]["error"]["category"] == "CELERY_TASK_FAILED"


def test_audio_retrieval_requires_completed_job_and_returns_file(monkeypatch, tmp_path):
    output = tmp_path / "job_audio.wav"
    output.write_bytes(b"wav-data")
    monkeypatch.setattr(jobs, "STORAGE_DIR", tmp_path)
    monkeypatch.setattr(jobs, "load_job", lambda _job_id: {"status": "COMPLETED", "result": {"audioPath": str(output)}})
    response = client.get("/internal/jobs/job_audio/audio", headers=auth())
    assert response.status_code == 200
    assert response.content == b"wav-data"


def test_audio_retrieval_reports_not_ready(monkeypatch):
    monkeypatch.setattr(jobs, "load_job", lambda _job_id: {"status": "PROCESSING", "result": None})
    response = client.get("/internal/jobs/job_processing/audio", headers=auth())
    assert response.status_code == 404


def test_synthesis_task_marks_failure_without_logging_provider_payload(monkeypatch, tmp_path):
    updates = []
    monkeypatch.setattr(speech_synthesis, "STORAGE_DIR", tmp_path)
    monkeypatch.setattr(speech_synthesis, "update_job", lambda job_id, **values: updates.append((job_id, values)))
    monkeypatch.setattr(speech_synthesis, "synthesize", lambda *_: (_ for _ in ()).throw(ValueError("provider error")))
    task = speech_synthesis.synthesize_job
    try:
        task.run("job_task", "Hello.", "Shivani", "auto", 1)
        assert False, "expected synthesis failure"
    except ValueError:
        pass
    assert any(values.get("status") == "FAILED" and values["error"]["category"] == "SYNTHESIS_FAILED" for _, values in updates)
    assert not (tmp_path / "job_task.wav").exists()


def test_synthesis_task_generates_audio_and_completes_job(monkeypatch, tmp_path):
    updates = []
    monkeypatch.setattr(speech_synthesis, "STORAGE_DIR", tmp_path)
    monkeypatch.setattr(speech_synthesis, "update_job", lambda job_id, **values: updates.append((job_id, values)))
    monkeypatch.setattr(speech_synthesis, "synthesize", lambda *_: b"wav-part")
    monkeypatch.setattr(speech_synthesis, "ffmpeg_executable", lambda: "ffmpeg")

    def make_output(command, **_kwargs):
        Path(command[-1]).write_bytes(b"wav-complete")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(speech_synthesis.subprocess, "run", make_output)
    result = speech_synthesis.synthesize_job.run("job_success", "Hello there.", "Shivani", "auto", 1.2)
    assert Path(result["audioPath"]).read_bytes() == b"wav-complete"
    assert any(values.get("status") == "COMPLETED" for _, values in updates)


def test_synthesis_task_removes_partial_output_after_concat_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(speech_synthesis, "STORAGE_DIR", tmp_path)
    monkeypatch.setattr(speech_synthesis, "update_job", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(speech_synthesis, "synthesize", lambda *_: b"wav-part")
    monkeypatch.setattr(speech_synthesis, "ffmpeg_executable", lambda: "ffmpeg")

    def fail_concat(command, **_kwargs):
        Path(command[-1]).write_bytes(b"partial")
        raise RuntimeError("concat failed")

    monkeypatch.setattr(speech_synthesis.subprocess, "run", fail_concat)
    try:
        speech_synthesis.synthesize_job.run("job_partial", "Hello.", "Shivani", "auto", 1)
        assert False, "expected concat failure"
    except RuntimeError:
        pass
    assert not (tmp_path / "job_partial.wav").exists()
    assert not (tmp_path / "job_partial").exists()
