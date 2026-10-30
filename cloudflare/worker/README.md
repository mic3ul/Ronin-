# Ronin Cloudflare Telegram Gateway

This Worker is a secure Telegram webhook edge gateway. It validates Telegram's
webhook secret and forwards updates to the existing Python/aiogram application.
The Worker does not replace Ronin's moderation, reputation, reports, scheduled
announcements, ML checks, or group handlers.

## Deployment options

### Worker gateway + external Python origin

The smallest setup keeps this Worker as the public Telegram endpoint and runs
the existing Python engine on a separate HTTPS host with a durable database.
This changes only update transport: polling is replaced by Telegram webhook
delivery. Do not remove the Python backend or its database.

### Full Python runtime with Cloudflare Containers

Cloudflare Containers can run Linux Docker images and are a possible host for
Ronin's existing Python runtime. Container deployment requires the Workers
Paid plan. It is not the same as deploying a lightweight Worker, and Ronin's
container image, memory use, model loading, and long-running scheduler still
need an actual deployment smoke test.

**Container disk is temporary.** Files written to its local filesystem can be
lost when the instance sleeps or restarts. Do not point production
`DB_URL` at the default `sqlite+aiosqlite:///db.sqlite` file inside the
container. Use a durable external SQL database, or implement and test a D1
adapter. D1 is not a drop-in replacement for the current Ormar/SQLAlchemy
database layer. The optional MySQL driver dependencies in `requirements.txt`
must be enabled and tested before using a remote MySQL URL.

Cloudflare Python Workers are not a drop-in runtime for the full application:
the project includes native ML dependencies and a Linux-oriented Docker
runtime. A Container is the more realistic Cloudflare route for preserving the
existing Python feature engine.

## Configure the Worker

1. Provision a compatible Python origin (external host or Cloudflare
   Container) with HTTPS and a durable database. Configure the origin to run
   `python webhook.py`, not the polling entry point.
2. Set the Worker secrets from this directory:

   ```bash
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put BACKEND_URL
   ```

   Use the same random value for `TELEGRAM_WEBHOOK_SECRET` and the Python
   origin's `WEBHOOK_SECRET`. Keep the bot token and all webhook secrets in
   the platform's secret manager; never commit them or paste them into chat.
   `BACKEND_URL` must be the HTTPS origin base URL.

3. Run the Worker tests and local development server:

   ```bash
   node --test test/index.test.js
   npx wrangler dev
   ```

4. Deploy the Worker only after the origin is reachable and its secrets are
   configured:

   ```bash
   npx wrangler deploy
   ```

5. Stop any running polling instance before enabling the Telegram webhook.
   Telegram cannot use polling and webhook delivery for the same bot at once.
   Start the Python origin with its platform-managed `BOT_TOKEN`,
   `WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_URL`, and durable `DB_URL`.

The Worker forwards authenticated updates to
`/telegram/webhook`. The Python origin must validate the same webhook secret.
The Worker returns non-2xx responses when the origin is unavailable so Telegram
can retry delivery.

## Endpoints

- `GET /health`: Worker liveness endpoint.
- `POST /telegram/webhook`: authenticated Telegram update relay.

## YouTube behavior

YouTube lookup is metadata-only: title, channel, duration, and the direct
YouTube link. Ronin does not download or re-host YouTube media.

## Production boundary

A successful Worker upload alone does not mean Ronin is deployed. Verify the
container or external Python origin, durable database persistence across
restarts, secret handling, Telegram webhook registration, and live update
processing before describing the bot as deployed. No production deployment is
claimed by this repository configuration.
