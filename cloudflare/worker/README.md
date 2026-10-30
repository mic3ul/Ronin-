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

1. Provision a compatible Python origin with HTTPS and a persistent database.
   Install the project and make its model files available, but do not start
   `webhook.py` yet. Record the origin base URL (for example,
   `https://ronin-origin.example.com`).

2. From this directory, configure the Worker secrets:

   ```bash
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put BACKEND_URL
   ```

   Use the exact same random value for `TELEGRAM_WEBHOOK_SECRET` and the
   Python `WEBHOOK_SECRET`. Set `BACKEND_URL` to the HTTPS Python origin base
   URL. These values are stored as Worker secrets, not committed to Git.

3. Test and deploy the Worker:

   ```bash
   node --test test/index.test.js
   npx wrangler dev
   npx wrangler deploy
   ```

4. Stop any running Ronin polling instance. Telegram cannot use polling and
   webhook delivery for the same bot at the same time. Then start the Python
   webhook process with:

   ```bash
   export BOT_TOKEN="..."
   export WEBHOOK_SECRET="the-same-value-used-for-the-Worker"
   export TELEGRAM_WEBHOOK_URL="https://<worker-name>.<account-subdomain>.workers.dev"
   export DB_URL="your-existing-durable-database-url"
   python webhook.py
   ```

   Its startup hook registers the Telegram webhook without dropping pending
   updates. The Python origin must be reachable over HTTPS at
   `/telegram/webhook` and retain its existing database and model files.

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
