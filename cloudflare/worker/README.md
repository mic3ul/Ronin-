# Ronin Cloudflare Telegram Gateway

This Worker is a secure Telegram webhook edge gateway. It validates Telegram's
webhook secret and forwards updates to the existing Python/aiogram application.

## Feature parity and runtime boundary

The Worker does **not** replace Ronin's Python feature engine. Keeping all
existing moderation, reputation, reports, scheduled announcements, ML spam and
NSFW checks, and YouTube tooling unchanged requires the Python runtime and its
persistent database. PyTorch/Transformers, FFmpeg, yt-dlp, the existing ORM, and
the long-running scheduler are not moved into the Worker.

This adapter changes only Telegram update transport: polling is replaced by
Telegram webhook delivery through Cloudflare. The Python backend remains
responsible for processing each update. Do not remove the Python backend or its
persistent database when deploying this gateway.

## Configure

1. Deploy the Python app with the webhook entry point:

   ```bash
   pip install -r requirements.txt
   export BOT_TOKEN="..."
   export WEBHOOK_SECRET="a-random-secret-with-letters-numbers-dashes"
   export TELEGRAM_WEBHOOK_URL="https://<worker-name>.<account-subdomain>.workers.dev"
   export DB_URL="your-existing-durable-database-url"
   python webhook.py
   ```

   The Python origin must be reachable over HTTPS at `/telegram/webhook`.
   Keep its existing durable database and all model files available. The origin
   must accept the same `WEBHOOK_SECRET` in Telegram's
   `X-Telegram-Bot-Api-Secret-Token` header.

2. From this directory, configure the Worker secret and origin URL:

   ```bash
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put BACKEND_URL
   ```

   Set `BACKEND_URL` to the HTTPS origin base URL (for example,
   `https://ronin-origin.example.com`). It is stored as a Worker secret here
   to avoid committing deployment-specific hostnames.

3. Test locally and deploy:

   ```bash
   node --test test/index.test.js
   npx wrangler dev
   npx wrangler deploy
   ```

4. Set `TELEGRAM_WEBHOOK_URL` in the Python backend to the deployed Worker
   base URL and restart the backend. Its startup hook registers the Telegram
   webhook without dropping pending updates.

## Endpoints

- `GET /health`: Worker liveness endpoint.
- `POST /telegram/webhook`: authenticated Telegram update relay.

The Worker returns non-2xx responses when the origin is unavailable so Telegram
can retry delivery. Never expose the Python origin without HTTPS and the
webhook-secret check. Keep `BOT_TOKEN`, `WEBHOOK_SECRET`, and
`TELEGRAM_WEBHOOK_SECRET` out of source control and logs.

## Important

Cloudflare Workers Free hosts this gateway, not the Python feature engine.
A free Cloudflare-only deployment of the entire existing bot is not currently
claimed: preserving the full PyTorch/Transformers + FFmpeg + database +
scheduler feature set requires a compatible Python compute origin. This
separation avoids silently disabling existing features.
