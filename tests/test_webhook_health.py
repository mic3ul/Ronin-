import importlib.util
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

# Avoid importing services/__init__.py, which loads the whole application and
# its optional configuration/ML dependencies during this isolated unit test.
MODULE_PATH = Path(__file__).resolve().parents[1] / "services" / "healthcheck.py"
SPEC = importlib.util.spec_from_file_location("ronin_healthcheck", MODULE_PATH)
healthcheck = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(healthcheck)

HealthCheckServer = healthcheck.HealthCheckServer
register_health_routes = healthcheck.register_health_routes


@pytest.mark.asyncio
async def test_webhook_health_and_readiness_routes():
    health = HealthCheckServer()
    app = web.Application()
    register_health_routes(app, health)

    async with TestClient(TestServer(app)) as client:
        live = await client.get("/health")
        assert live.status == 200
        assert await live.json() == {"status": "healthy"}

        not_ready = await client.get("/ready")
        assert not_ready.status == 503
        assert await not_ready.json() == {"status": "not ready"}

        health.set_ready(True)
        ready = await client.get("/ready")
        assert ready.status == 200
        assert await ready.json() == {"status": "ready"}
