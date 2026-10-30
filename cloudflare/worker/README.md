# Ronin — Cloudflare-native Telegram bot

Ronin now has a native Cloudflare Workers runtime. It does **not** proxy updates
to a separate Python server and does not require Cloudflare Containers, a
persistent VM, Docker, or a paid Workers plan.

## Cloudflare architecture

- **Workers** receives Telegram webhook updates and calls the Telegram Bot API.
- **D1** stores member reputation, moderation counters, reports, newcomer
  burst state, and processed update IDs.
- **Workers Free** can run the Worker and D1 within their published quotas.
- Secrets stay in Cloudflare's secret store; they are not committed to GitHub.

The original Python/aiogram application remains in the repository as a
self-hosted runtime. It is not imported by the Cloudflare Worker: aiogram,
PyTorch, Transformers, ONNX/PIL image pipelines, Ormar/SQLAlchemy, and
long-running asyncio tasks are not a compatible drop-in bundle for the
Workers isolate runtime. The Cloudflare version uses the Telegram HTTP Bot API
directly and D1 for persistent state.

## Features in the native Cloudflare runtime

Implemented in this first native port:

- Telegram webhook authentication and payload size validation.
- Retry-safe update deduplication in D1.
- Main-group allowlist.
- Member message counts and reputation persistence.
- Low-reputation link, media, and single-emoji restrictions.
- Known VPN spam token detection and short drug-bait pattern detection.
- Optional profanity term matching via the `PROFANITY_TERMS` variable.
- Newcomer-burst detection with configurable log/delete action.
- `/ping`, `/rules`, `/me`, `/profile`, `/id`, `/help`, `/report`, `/ban`, and `/unban`.
- Arabic group entertainment: `/games`, `/quiz`, car trivia (`/cars`), `/rps`, `/truth` (صراحة), `/wyr` (this-or-that), and `/coin` (coin toss).
- Race-safe game completion: only the first valid quiz answer can claim a round; RPS is restricted to the player who started it.
- Daily check-ins (`/checkin`) and a per-group reputation leaderboard (`/top`).
- Member profile cards (`/profile`) with deterministic XP levels, group rank, message totals, and milestone badges; `/id` shows the current group and member IDs, and `/help` lists commands.
- Private one-to-one whispers (`/whisper @username text`) with an explicit open button and an opened status.
- Private `/start` registration so users can receive whispers; recipients must start the bot first.
- Moderator report buttons, audit log output, and optional repeat-spam autoban.

Not yet ported from the Python runtime:

- The original PyTorch/Transformers spam model and SigLIP NSFW/profile-photo
  classifier. Workers AI is a possible future replacement, but it is not
  silently substituted with an unrelated model.
- Full Censure/Fluent language packs, gender extraction, profile-photo
  scanning, recent-message retrospective cleanup, reaction automation,
  scheduled announcements, seasonal game logic, and every legacy command.
- The original Ormar database model and its data. D1 starts with a new schema;
  no existing SQLite/MySQL data is copied or deleted.

The Cloudflare runtime should therefore be treated as a new native deployment
with a documented feature subset, not as a claim of 1:1 parity with the
Python bot.

## Setup

### 1. Create/apply the D1 schema

The D1 database `ronin-db` is provisioned in the connected Cloudflare account
and its ID is stored in `wrangler.jsonc`.

From `cloudflare/worker`:

```bash
npx wrangler d1 migrations apply ronin-db --remote
```

This applies only the checked-in migration. It does not run the repository's
legacy `db_init.py` (which is destructive) and does not touch another D1 DB.

### 2. Configure secrets

From `cloudflare/worker`:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Use a random webhook secret containing only Telegram-supported characters
(A-Z, a-z, 0-9, underscore, hyphen), 1–256 characters. Do not put either
secret in `wrangler.jsonc`, GitHub, or chat messages.

### 3. Configure non-secret variables

Set these in the Worker settings or add them to `vars` in `wrangler.jsonc`:

- `MAIN_GROUP_IDS`: JSON array of group IDs, for example `[-1001234567890]`.
- `REPORTS_CHAT_ID`: private reports channel/group ID.
- `LOGS_CHAT_ID`: moderation log channel/group ID.
- `OWNER_ID`: reserved for future owner-only controls.
- `RULES_TEXT`: optional HTML group rules.
- `PROFANITY_TERMS`: optional pipe-separated terms for the basic native filter.
- `AUTOBAN_ENABLED`: leave `false` until moderation thresholds are validated.
- `BURST_ENABLED`, `BURST_ACTION`: `log` is the safe default; `delete` is more aggressive.
- `MEDIA_REP_THRESHOLD`, `LINK_REP_THRESHOLD`, `SINGLE_EMOJI_REP_THRESHOLD`.

Whispers are delivered only to users who have opened the bot and sent `/start`; Telegram does not let a bot initiate a private conversation with an arbitrary username. The opened indicator is recorded when the recipient presses **Open whisper** (the Bot API does not expose message read receipts).

The initial configuration intentionally leaves `MAIN_GROUP_IDS` empty and
autoban disabled so a fresh deployment cannot moderate an unintended group.

Apply all checked-in migrations, including `0002_social_games_whispers.sql`, `0003_daily_checkins.sql`, and `0004_group_leaderboard.sql`, before deploying the updated Worker. These migrations are additive and do not delete existing data.

### 4. Deploy the Worker

```bash
npx wrangler deploy
```

Check `https://<worker-subdomain>.workers.dev/health`. It should return
`{"service":"ronin-cloudflare-bot","status":"ok","runtime":"workers+d1"}`.

### 5. Register Telegram webhook

Stop the old polling process first. Telegram cannot deliver updates through
polling and webhook simultaneously.

The Worker includes an authenticated setup endpoint. After adding both secrets
in Cloudflare, run this in Termux (it prompts for the setup secret without
putting it directly in the shell command history):

```bash
read -rsp "Webhook setup secret: " RONIN_SETUP_KEY; echo
curl -sS -X POST "https://ronin-telegram-edge.mic3ul-weirdwolf.workers.dev/telegram/setup" \
  -H "X-Ronin-Setup-Key: ${RONIN_SETUP_KEY}"
unset RONIN_SETUP_KEY
```

The endpoint registers `/telegram/webhook` with Telegram using the configured
secret and returns `getWebhookInfo`. It rejects requests without the matching
setup secret. Add the bot as an administrator in each configured group and
disable BotFather privacy mode if it must inspect ordinary group messages.

## Limits and cost

This design uses Workers and D1, not Containers. Workers Free currently has a
daily request and CPU allowance; D1 also has daily read/write and storage
quotas. If an account reaches a free quota, operations can fail until reset.
Workers AI is not required by this runtime and no paid AI model is invoked.

## Security and operational notes

- The Worker rejects requests without the Telegram webhook secret.
- Update IDs are persisted in D1. Failed updates are removed from the
  processing table so Telegram can retry; completed updates are deduplicated.
- Automatic bans are disabled by default.
- Only group IDs explicitly listed in `MAIN_GROUP_IDS` are moderated.
- No webhook is registered automatically by deployment. Register it only
  after configuring secrets, groups, bot permissions, and D1 migration.
- Keep the Python polling runtime unchanged until the Cloudflare version has
  been tested in a controlled group. Do not run both delivery modes at once.
