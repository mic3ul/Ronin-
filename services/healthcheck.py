"""Health and readiness endpoints for the bot runtime."""

import logging

from aiohttp import web

logger = logging.getLogger(__name__)


class HealthCheckServer:
    """Expose /health and /ready endpoints for process monitoring."""

    def __init__(self, host: str = "0.0.0.0", port: int = 8080) -> None:
        self.host = host
        self.port = port
        self.app = web.Application()
        self.runner: web.AppRunner | None = None
        self._is_ready = False

        self.app.router.add_get("/health", self._health_handler)
        self.app.router.add_get("/ready", self._ready_handler)
        self.app.router.add_get("/", self._health_handler)

    async def _health_handler(self, request: web.Request) -> web.Response:
        """Return success while the HTTP server is running."""
        return web.json_response({"status": "healthy"})

    async def _ready_handler(self, request: web.Request) -> web.Response:
        """Return success only after bot startup has completed."""
        if self._is_ready:
            return web.json_response({"status": "ready"})
        return web.json_response({"status": "not ready"}, status=503)

    def set_ready(self, ready: bool = True) -> None:
        """Set whether the bot is ready to process updates."""
        self._is_ready = ready

    async def start(self) -> None:
        """Start the standalone health-check HTTP server."""
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()

        site = web.TCPSite(self.runner, self.host, self.port)
        await site.start()

        logger.info("Health check server started on %s:%s", self.host, self.port)

    async def stop(self) -> None:
        """Stop the standalone health-check HTTP server."""
        if self.runner:
            await self.runner.cleanup()
            logger.info("Health check server stopped")


_health_server: HealthCheckServer | None = None


def get_health_server(host: str = "0.0.0.0", port: int = 8080) -> HealthCheckServer:
    """Get or create the process-wide health-check server."""
    global _health_server
    if _health_server is None:
        _health_server = HealthCheckServer(host=host, port=port)
    return _health_server


async def start_health_server(host: str = "0.0.0.0", port: int = 8080) -> HealthCheckServer:
    """Start the process-wide health-check server."""
    server = get_health_server(host, port)
    await server.start()
    return server


async def stop_health_server() -> None:
    """Stop and clear the process-wide health-check server."""
    global _health_server
    if _health_server:
        await _health_server.stop()
        _health_server = None


def register_health_routes(app: web.Application, server: HealthCheckServer | None = None) -> None:
    """Mount health and readiness routes on an existing aiohttp app."""
    health_server = server or get_health_server()
    app.router.add_get("/health", health_server._health_handler)
    app.router.add_get("/ready", health_server._ready_handler)
