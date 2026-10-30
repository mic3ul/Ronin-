"""Run Ronin behind a Cloudflare Worker Telegram webhook gateway.

The Worker is the public Telegram endpoint. This Python process remains the
feature engine so the existing aiogram handlers, ML models, database layer,
scheduler, and media tools keep their current behavior.
"""
import logging
import os
import re

from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application

from bot import on_shutdown, on_startup
from config import config
from handlers import register_all_handlers
from middlewares import register_all_middlewares

logger = logging.getLogger(__name__)
WEBHOOK_PATH = "/telegram/webhook"


def create_webhook_app() -> tuple[web.Application, Bot]:
    token = config.bot.token.get_secret_value()
    webhook_url = os.environ.get("TELEGRAM_WEBHOOK_URL", "").rstrip("/")
    secret = os.environ.get("WEBHOOK_SECRET", "")

    if not token:
        raise RuntimeError("BOT_TOKEN is required")
    if not webhook_url.startswith("https://"):
        raise RuntimeError("TELEGRAM_WEBHOOK_URL must be the HTTPS Cloudflare Worker URL")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", secret):
        raise RuntimeError("WEBHOOK_SECRET must use 1-256 Telegram-supported characters")

    bot = Bot(
        token=token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = Dispatcher()
    register_all_handlers(dispatcher)
    register_all_middlewares(
        dispatcher,
        default_locale=config.locale.default,
        enable_throttling=config.throttling.enabled,
        throttle_rate=config.throttling.rate_limit,
        throttle_max_messages=config.throttling.max_messages,
        throttle_time_window=config.throttling.time_window,
    )
    dispatcher.startup.register(on_startup)
    dispatcher.shutdown.register(on_shutdown)

    app = web.Application(client_max_size=1024 * 1024)
    SimpleRequestHandler(
        dispatcher=dispatcher,
        bot=bot,
        secret_token=secret,
    ).register(app, path=WEBHOOK_PATH)
    setup_application(app, dispatcher, bot=bot)

    async def set_telegram_webhook(_: web.Application) -> None:
        await bot.set_webhook(
            url=f"{webhook_url}{WEBHOOK_PATH}",
            secret_token=secret,
            allowed_updates=dispatcher.resolve_used_update_types(),
            drop_pending_updates=False,
        )
        logger.info("Telegram webhook registered through Cloudflare Worker")

    app.on_startup.append(set_telegram_webhook)
    app.on_cleanup.append(lambda _: bot.session.close())
    return app, bot


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    app, _ = create_webhook_app()
    web.run_app(
        app,
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8080")),
    )


if __name__ == "__main__":
    main()
