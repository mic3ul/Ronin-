FROM python:3.12-slim

WORKDIR /app

# Install the compiler required by some Python wheels.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd -m -u 1000 botuser && mkdir -p /app/data && chown -R botuser:botuser /app
USER botuser

# Keep polling as the default; set RUN_MODE=webhook for the Cloudflare gateway.
ENV RUN_MODE=polling
EXPOSE 8080

CMD ["sh", "-c", "if [ \"$RUN_MODE\" = \"webhook\" ]; then exec python webhook.py; else exec python bot.py; fi"]
