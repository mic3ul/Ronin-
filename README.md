# 👹 Samurai Telegram Bot
![Samurai Telegram Bot](https://i.imgur.com/S9BPDMt.jpeg "te")
Simple, yet effective **auto-moderator bot for telegram**.  
With reports, logs, profanity filter, anti-spam AI, NSFW detection, reputation system and more :3

## What does Samurai do?

- **Anti-Profanity**: Automatically detects and removes messages containing profanity (Russian/English)
- **Anti-Spam**: ML-based spam detection for new users
- **NSFW Detection**: Analysis of eligible in-chat images and user profile photos, with recent-message cleanup after detection
- **Reputation System**: Users gain reputation through positive participation
- **Report System**: Users can report messages to admins
- **Scheduled Announcements**: Periodic automated messages

## Code Hierarchy

```
samurai/
├── bot.py                 # Main entry point
├── config/
│   ├── __init__.py
│   ├── settings.py        # Pydantic configuration
├── core/
│   ├── __init__.py
│   └── i18n.py            # Fluent internationalization
├── db/
│   ├── __init__.py
│   ├── database.py        # Database setup
│   └── models/
│       ├── member.py      # Member model
│       └── spam.py        # Spam record model
├── filters/
│   ├── is_owner.py
│   ├── is_admin.py
│   ├── throttle.py
│   └── .. other useful filters
├── handlers/
│   ├── admin_actions.py   # Ban/unban commands
│   ├── callbacks.py       # Inline button handlers
│   ├── exceptions.py      # Error handler
│   ├── group_events.py    # Main message processing
│   ├── personal_actions.py# Ping, profanity check
│   └── user_actions.py    # Report command
├── locales/
│   ├── en/
│   │   ├── strings.ftl    # English translations
│   │   └── announcements.ftl
│   └── ru/
│       ├── strings.ftl    # Russian translations
│       └── announcements.ftl
├── middlewares/
│   ├── __init__.py
│   ├── throttling.py      # Middleware for rate limiting
│   ├── i18n.py            # I18n middleware
│   └── recent_messages.py # Tracks messages for retrospective moderation
├── services/
│   ├── announcements.py   # Scheduled announcements
│   ├── cache.py           # TTL/LRU caches and batched database updates
│   ├── gender.py          # Gender detection
│   ├── nsfw.py            # NSFW detection
│   ├── profanity.py       # Profanity detection
│   ├── healthcheck.py     # Health-check server for container orchestration
│   ├── ml_manager.py      # Unloads unused ML models from memory after some time
│   ├── recent_messages.py # Recent-message history and cleanup
│   ├── reports.py         # Report state and duplicate prevention
│   └── spam.py            # Spam detection
├── utils/
│   ├── helpers.py         # Utility functions
│   ├── enums.py           # Some useful enums to keep the codebase consistent
│   └── localization.py    # Localization exports
├── libs/                  # External libraries (censure, gender_extractor)
├── ruspam_model/          # ML model for spam detection
├── config.toml            # Main configuration file
├── pyproject.toml         # Package metadata and dependencies
├── requirements.txt
├── Dockerfile
├── db_init.py             # Use this to initialize your database tables
└── .env.example
```

## Internationalization (i18n)

The bot uses [Project Fluent](https://projectfluent.org/) for translations.

### Usage in handlers

```python
# Method 1: Import _ function directly
from core.i18n import _

async def handler(message: Message) -> None:
    text = _("error-no-reply")
    await message.reply(text)

# Method 2: Use i18n from middleware (user's locale)
async def handler(message: Message, i18n: Callable) -> None:
    text = i18n("error-no-reply")
    await message.reply(text)

# With variables
text = _("report-message", date="2024-01-01", chat_id="123", msg_id="456")
```

### Adding new translations

1. Create/edit `.ftl` files in `locales/{lang}/`
2. Use hyphenated keys: `error-no-reply`
3. Variables use `{ $var }` syntax

Example `locales/ru/strings.ftl`:
```fluent
error-no-reply = Эта команда должна быть ответом на сообщение!
report-message = 👆 Отправлено { $date }
    <a href="https://t.me/c/{ $chat_id }/{ $msg_id }">Перейти</a>
```

## Installation

### Prerequisites

- Python 3.11+ is required
- Bot token from [@BotFather](https://t.me/BotFather)

### Telegram side setup

Samurai must receive ordinary group messages to moderate them:

1. Open [@BotFather](https://t.me/BotFather), select the bot, and disable group privacy mode under **Bot Settings → Group Privacy**.
2. Add the bot as an administrator in every group listed in `groups.main`.
3. Grant at least **Delete messages**, **Ban users**, and **Restrict users** permissions.
4. Add the bot to the private reports and logs channels and allow it to post and edit its messages.

Without these permissions, Telegram will not deliver all relevant messages or will reject moderation actions.

### Setup process

1. Clone the repository

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```

4. Configure `config.toml` with your group IDs and other settings how you like

5. Run the bot:
   ```bash
   python bot.py
   ```

   Alternatively, install the project as a package and use its console command:
   ```bash
   pip install -e ".[ml]"
   samurai
   ```

   Run the installed command from the repository root because the bot loads its locales, configuration, and bundled spam model through project-relative paths.

6. Enjoy!

### Environment Variables in Production

For production deployments, you can also set environment variables directly instead of using `.env` file:

```bash
# Export variables directly
export BOT_TOKEN="your_bot_token"
export BOT_OWNER="your_user_id"
export GROUPS_MAIN="-1001234567890"
export DB_URL="sqlite+aiosqlite:///samurai.db"

# Or pass them inline
BOT_TOKEN="..." BOT_OWNER="..." python bot.py
```

For **systemd** services, add them to the unit file:
```ini
[Service]
Environment="BOT_TOKEN=your_token"
Environment="BOT_OWNER=123456789"
```

For **Docker**, use `-e` flags or `--env-file`:
```bash
docker run -e BOT_TOKEN="..." -e BOT_OWNER="..." samurai-bot
# or
docker run --env-file .env samurai-bot
```

### Database Initialization

The `db_init.py` script can be used to create or recreate database tables.

⚠️ **WARNING**: This script will **DROP ALL DATA** in the tables!  
Make sure to backup first if running on an existing database.

```bash
# 1. Open db_init.py and comment out or delete this line:
#    exit("COMMENT THIS LINE IN ORDER TO RE-INIT DATABASE TABLES")

# 2. Run the script
python db_init.py

# 3. Uncomment the exit() line again to prevent accidental runs or just delete this file after usage
```

Use this script **ONLY** when:
- Setting up the bot for the first time
- Migrating to a new database
- Resetting all data *(development only)*

[!] The project currently has no schema migration system.  
Back up the database before changing models or running this script.

### Docker

```bash
docker build -t samurai-bot .
docker volume create samurai-data
docker run -d --name samurai-bot \
  --env-file .env \
  -e DB_URL="sqlite+aiosqlite:////app/data/samurai.db" \
  -v "$(pwd)/config.toml:/app/config.toml:ro" \
  -v samurai-data:/app/data \
  -p 8080:8080 \
  samurai-bot
```

The data volume preserves the SQLite database and announcement timestamps across container replacement. Port `8080` is only needed when `[healthcheck].enabled = true`.

The Docker build context excludes local `.env` files and database files. Pass `BOT_TOKEN` at runtime with `--env-file` or a platform secret; never put a real token in `config.toml` or bake it into the image.

### Health checks (heartbeat)

When enabled in `config.toml`, the HTTP server exposes:

- `GET /health` - returns success while the server is running
- `GET /ready` - returns HTTP 200 after bot startup and HTTP 503 during startup or shutdown

Set `HEALTHCHECK_PORT` to override the configured port through the environment.

## RAM usage

Currently bot uses ~800mb of RAM for ML models and for data caching.  
~~Probably we could reduce ML models RAM usage by implementing ONNX runtime models, but that's plans for future updates.~~  
That ain't worked, the only viable solution would be to quantize the models :3  

However memory usage depends on which lazy-loaded ML models are active.  
The ML manager can unload inactive models when `[ml].auto_unload_enabled` is enabled.

If the server kills the process due to an out-of-memory condition (`dmesg | grep -i "killed process"`), consider enabling model auto-unload, reducing cache sizes, adding memory, or adding swap:
```bash
# Create 2GB swap file
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token |
| `BOT_OWNER` | Owner's Telegram user ID |
| `BOT_LOCALE` | Default locale, such as `ru` or `en` |
| `GROUPS_MAIN` | Main group chat ID __(can be a comma separated list)__ |
| `GROUPS_REPORTS` | Reports group chat ID |
| `GROUPS_LOGS` | Logs group chat ID |
| `LINKED_CHANNELS` | Linked channel IDs __(comma-separated)__ |
| `DB_URL` | Async database URL, for example `sqlite+aiosqlite:///db.sqlite` |
| `HEALTHCHECK_PORT` | Health-check HTTP port |
| `CONFIG_FILE_PATH` | Path to an alternative TOML configuration file |

All behavior settings are available in `config.toml`, including spam thresholds, NSFW thresholds and cleanup, cache sizes, throttling, announcements, health checks, and ML model lifecycle management.

## Built-in Commands

### User Commands

| Command | Description |
|---------|-------------|
| `!rules` / `/rules` | Request the chat rules |
| `!report` / `/report` | Report a message (reply) |
| `!me` / `!info` | Show user info |
| `!бу` | Fun command (bot pretends to be scared lol) |
| `@admin` | Call admin attention |

### Admin Commands

| Command | Description |
|---------|-------------|
| `!ban` | Ban user (reply) |
| `!unban` | Unban user (reply) |
| `!ping` | Check bot status |
| `!prof <text>` | Check text for profanity |

### Owner Commands

| Command | Description |
|---------|-------------|
| `!spam` | Mark message as spam (reply) |
| `!reward <points>` | Add reputation points |
| `!punish <points>` | Remove reputation points |
| `!setlvl <level>` | Set user level |
| `!rreset` | Reset user reputation |
| `!msg <text>` | Send message from bot |
| `!chatid` | Get current chat ID |
| `!reload` | Reload announcements from localization files |
| `!log <text>` | Write test log |
| `!nsfw` | Test an attached image for NSFW content (use as the photo caption) |
| `!top_violators_profanity [count]` | Show users with the most profanity violations |
| `!top_violators_spam [count]` | Show users with the most spam violations |

Commands registered with both prefixes can also be used with `/` instead of `!`.

## YouTube search

Search for songs, music, and videos directly from a group or private chat:

- `/yt <search terms>`
- `/youtube <search terms>`
- `/يوت <اسم الأغنية>`
- `/يوتيوب <اسم الفيديو>`

The bot returns up to five matching YouTube results with title, channel, duration, and direct links. This feature is metadata-only: Ronin does not download, copy, or re-host YouTube media.

## External Libraries

The bot uses two external libraries in the `libs/` folder:

- **censure**: Russian/English profanity detection
- **gender_extractor**: Gender detection from names

## Credits
https://github.com/masteroncluster/py-censure - Profanity filter we used as a base  
https://github.com/MasterGroosha/telegram-report-bot - Reports system we used as a base  
https://huggingface.co/RUSpam/spam_deberta_v4 - Anti-Spam AI model we used as a base  
https://github.com/wwydmanski/gender-extractor - Gender detection we used as a base  
https://huggingface.co/prithivMLmods/siglip2-x256-explicit-content - Our current NSFW detection model

## Author of Samurai

(C) 2026 Abraham Tugalov


## Cloudflare webhook gateway

Ronin includes an optional Cloudflare Workers gateway for Telegram webhook
delivery. It preserves the existing Python/aiogram handlers and processing
pipeline; the Worker validates Telegram's webhook secret and forwards updates
to the Python origin. This means moderation, reputation, reports, scheduled
announcements, ML checks, and YouTube features are not replaced with reduced
Worker implementations.

See [cloudflare/worker/README.md](cloudflare/worker/README.md) for deployment
instructions and required environment variables. Run the Python webhook
backend with `python webhook.py` and configure the Worker with
`TELEGRAM_WEBHOOK_SECRET` and `BACKEND_URL`.

**Runtime and storage boundary:** the Worker is only the webhook edge. The full
Python application can also be packaged for Cloudflare Containers, which run
Linux images but require the Workers Paid plan. This route has not been validated
for Ronin yet. Container-local filesystems are ephemeral, so the default
SQLite file must not be used as the production database. Use an external durable
SQL database, or implement and test a D1 adapter; D1 is not a drop-in replacement
for the current Ormar/SQLAlchemy SQLite URL. The current MySQL driver entries
are optional and must be installed and tested before using a remote MySQL URL.

Do not call Ronin deployed until a real container/origin, durable database,
Cloudflare Secrets, webhook delivery, and live Telegram update processing have
all been verified.
