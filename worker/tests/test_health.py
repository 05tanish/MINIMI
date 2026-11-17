import os
import sys
from pathlib import Path

os.environ.setdefault("WORKER_STORAGE_DIR", "/tmp/minimi-health-tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import health


def test_liveness_is_process_only(monkeypatch):
    def dependency_must_not_be_called(*args, **kwargs):
        raise AssertionError("liveness must not check dependencies")

    monkeypatch.setattr(health.redis, "ping", dependency_must_not_be_called)
    monkeypatch.setattr(health.celery_app.control, "ping", dependency_must_not_be_called)
    assert health.live()["data"]["workerApi"] == "alive"


def test_readiness_checks_redis_and_celery(monkeypatch):
    calls = []
    monkeypatch.setattr(health.redis, "ping", lambda: calls.append("redis"))
    monkeypatch.setattr(health.celery_app.control, "ping", lambda timeout: calls.append(("celery", timeout)) or [{"celery@worker": "pong"}])
    response = health.health()
    assert response["data"]["redis"] == "ready"
    assert response["data"]["celery"] == "ready"
    assert calls == ["redis", ("celery", 1.0)]


def test_readiness_reports_redis_failure_without_checking_celery(monkeypatch):
    def unavailable():
        raise ConnectionError("unavailable")

    monkeypatch.setattr(health.redis, "ping", unavailable)
    monkeypatch.setattr(health.celery_app.control, "ping", lambda timeout: (_ for _ in ()).throw(AssertionError("must not ping Celery")))
    response = health.health()
    assert response.status_code == 503
    assert b'"redis":"unavailable"' in response.body


def test_readiness_reports_celery_failure_separately(monkeypatch):
    monkeypatch.setattr(health.redis, "ping", lambda: True)
    monkeypatch.setattr(health.celery_app.control, "ping", lambda timeout: (_ for _ in ()).throw(TimeoutError("unavailable")))
    response = health.health()
    assert response.status_code == 503
    assert b'"redis":"ready"' in response.body
    assert b'"celery":"unavailable"' in response.body
